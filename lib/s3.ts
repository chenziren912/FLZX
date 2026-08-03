export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type S3ListResult = {
  keys: string[];
  nextCursor: string | null;
  complete: boolean;
};

export class S3RequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "S3RequestError";
    this.status = status;
  }
}

const textEncoder = new TextEncoder();

function bytes(value: string | ArrayBuffer | Uint8Array) {
  if (typeof value === "string") {
    return textEncoder.encode(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return value;
}

function hex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string | ArrayBuffer | Uint8Array) {
  return hex(await crypto.subtle.digest("SHA-256", bytes(value)));
}

async function hmac(key: string | ArrayBuffer | Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    bytes(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(value)),
  );
}

async function hmacHex(key: string | ArrayBuffer | Uint8Array, value: string) {
  return hex(await hmac(key, value));
}

export async function sha256Hex(value: string | ArrayBuffer | Uint8Array) {
  return sha256(value);
}

function base64Url(value: Uint8Array) {
  let binary = "";
  value.forEach((item) => {
    binary += String.fromCharCode(item);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function hmacBase64Url(
  key: string | ArrayBuffer | Uint8Array,
  value: string,
) {
  return base64Url(await hmac(key, value));
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => {
    return "%" + character.charCodeAt(0).toString(16).toUpperCase();
  });
}

function encodePath(value: string) {
  return value
    .split("/")
    .map((segment) => awsEncode(segment))
    .join("/");
}

function canonicalQuery(searchParams: URLSearchParams) {
  return Array.from(searchParams.entries())
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      return leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey);
    })
    .map(([key, value]) => key + "=" + value)
    .join("&");
}

function canonicalHeaderValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function amzDate(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function dateStamp(value: string) {
  return value.slice(0, 8);
}

function isStream(value: unknown): value is ReadableStream<Uint8Array> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "getReader" in (value as Record<string, unknown>),
  );
}

function xmlUnescape(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function joinPath(left: string, right: string) {
  return (left.replace(/\/+$/g, "") + "/" + right.replace(/^\/+/g, "")).replace(
    /^$/,
    "/",
  );
}

type RequestOptions = {
  query?: Array<[string, string]>;
  headers?: HeadersInit;
  body?: BodyInit | ReadableStream<Uint8Array> | null;
  payloadHash?: string;
};

export class S3CompatibleStore {
  private readonly endpoint: URL;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(config: S3Config) {
    this.endpoint = new URL(config.endpoint);
    this.bucket = config.bucket;
    this.region = config.region;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
  }

  private objectUrl(key = "", query: Array<[string, string]> = []) {
    const url = new URL(this.endpoint.toString());
    url.pathname = joinPath(
      this.endpoint.pathname,
      encodePath(this.bucket) + (key ? "/" + encodePath(key) : ""),
    );
    url.search = "";
    query.forEach(([name, value]) => {
      url.searchParams.append(name, value);
    });
    return url;
  }

  private async signedRequest(
    method: string,
    key: string,
    options: RequestOptions = {},
  ) {
    const url = this.objectUrl(key, options.query);
    const inputHeaders = new Headers(options.headers);
    const body = options.body ?? null;
    let payloadHash = options.payloadHash;

    if (!payloadHash) {
      if (body === null) {
        payloadHash = await sha256("");
      } else if (isStream(body)) {
        payloadHash = "UNSIGNED-PAYLOAD";
      } else if (typeof body === "string" || body instanceof ArrayBuffer) {
        payloadHash = await sha256(body);
      } else {
        payloadHash = await sha256(new Uint8Array(body as ArrayBufferView));
      }
    }

    const requestDate = amzDate();
    const shortDate = dateStamp(requestDate);
    const scope =
      shortDate + "/" + this.region + "/s3/aws4_request";
    inputHeaders.set("host", url.host);
    inputHeaders.set("x-amz-date", requestDate);
    inputHeaders.set("x-amz-content-sha256", payloadHash);

    const signedHeaders = Array.from(inputHeaders.keys())
      .map((name) => name.toLowerCase())
      .filter((name) => name !== "authorization" && name !== "content-length")
      .sort();
    const canonicalHeaders = signedHeaders
      .map((name) => name + ":" + canonicalHeaderValue(inputHeaders.get(name) ?? ""))
      .join("\n") + "\n";
    const signedHeaderText = signedHeaders.join(";");
    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery(url.searchParams),
      canonicalHeaders,
      signedHeaderText,
      payloadHash,
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      requestDate,
      scope,
      await sha256(canonicalRequest),
    ].join("\n");
    const dateKey = await hmac("AWS4" + this.secretAccessKey, shortDate);
    const regionKey = await hmac(dateKey, this.region);
    const serviceKey = await hmac(regionKey, "s3");
    const signingKey = await hmac(serviceKey, "aws4_request");
    const signature = await hmacHex(signingKey, stringToSign);
    inputHeaders.set(
      "authorization",
      "AWS4-HMAC-SHA256 Credential=" +
        this.accessKeyId +
        "/" +
        scope +
        ", SignedHeaders=" +
        signedHeaderText +
        ", Signature=" +
        signature,
    );

    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers: inputHeaders,
    };
    if (body !== null) {
      init.body = body as BodyInit;
      if (isStream(body)) {
        init.duplex = "half";
      }
    }

    const response = await fetch(url.toString(), init);
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new S3RequestError(
        "S3 request failed (" + response.status + "): " + message.slice(0, 300),
        response.status,
      );
    }
    return response;
  }

  async presign(
    method: "GET" | "PUT",
    key: string,
    expiresInSeconds = 900,
  ) {
    const url = this.objectUrl(key);
    const requestDate = amzDate();
    const shortDate = dateStamp(requestDate);
    const scope =
      shortDate + "/" + this.region + "/s3/aws4_request";
    url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    url.searchParams.set("X-Amz-Credential", this.accessKeyId + "/" + scope);
    url.searchParams.set("X-Amz-Date", requestDate);
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
    url.searchParams.set("X-Amz-SignedHeaders", "host");
    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery(url.searchParams),
      "host:" + url.host + "\n",
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      requestDate,
      scope,
      await sha256(canonicalRequest),
    ].join("\n");
    const dateKey = await hmac("AWS4" + this.secretAccessKey, shortDate);
    const regionKey = await hmac(dateKey, this.region);
    const serviceKey = await hmac(regionKey, "s3");
    const signingKey = await hmac(serviceKey, "aws4_request");
    url.searchParams.set("X-Amz-Signature", await hmacHex(signingKey, stringToSign));
    return url.toString();
  }

  async getObject(key: string) {
    const response = await this.signedRequest("GET", key);
    return {
      body: await response.arrayBuffer(),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      contentLength: Number(response.headers.get("content-length") ?? 0),
    };
  }

  async getObjectStream(key: string) {
    return this.signedRequest("GET", key);
  }

  async headObject(key: string) {
    try {
      const response = await this.signedRequest("HEAD", key);
      return {
        contentType:
          response.headers.get("content-type") ?? "application/octet-stream",
        contentLength: Number(response.headers.get("content-length") ?? 0),
      };
    } catch (error) {
      if (error instanceof S3RequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async putObject(
    key: string,
    body: string | ArrayBuffer | Uint8Array,
    contentType = "application/octet-stream",
  ) {
    const payload = typeof body === "string" ? body : body;
    await this.signedRequest("PUT", key, {
      headers: { "content-type": contentType },
      body: payload as BodyInit,
    });
  }

  async putObjectStream(
    key: string,
    body: ReadableStream<Uint8Array>,
    contentType = "application/octet-stream",
  ) {
    await this.signedRequest("PUT", key, {
      headers: { "content-type": contentType },
      body,
      payloadHash: "UNSIGNED-PAYLOAD",
    });
  }

  async deleteObject(key: string) {
    await this.signedRequest("DELETE", key);
  }

  async listObjects(
    prefix = "",
    cursor: string | null = null,
    maxKeys = 1000,
  ): Promise<S3ListResult> {
    const query: Array<[string, string]> = [
      ["list-type", "2"],
      ["max-keys", String(Math.min(maxKeys, 1000))],
    ];
    if (prefix) {
      query.push(["prefix", prefix]);
    }
    if (cursor) {
      query.push(["continuation-token", cursor]);
    }
    const response = await this.signedRequest("GET", "", { query });
    const xml = await response.text();
    const keys = Array.from(xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)).map(
      (match) => xmlUnescape(match[1]),
    );
    const nextMatch = xml.match(
      /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/,
    );
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    return {
      keys,
      nextCursor: nextMatch ? xmlUnescape(nextMatch[1]) : null,
      complete: !truncated,
    };
  }
}
