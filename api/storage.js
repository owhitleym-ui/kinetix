import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import common from "oci-common";
import * as objectstorage from "oci-objectstorage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let client = null;
let enabled = false;

export function initStorage() {
  const {
    OCI_TENANCY_ID,
    OCI_USER_ID,
    OCI_FINGERPRINT,
    OCI_PRIVATE_KEY_PATH,
    OCI_REGION,
    OCI_NAMESPACE,
    OCI_BUCKET,
  } = process.env;

  const missing = [
    ["OCI_TENANCY_ID", OCI_TENANCY_ID],
    ["OCI_USER_ID", OCI_USER_ID],
    ["OCI_FINGERPRINT", OCI_FINGERPRINT],
    ["OCI_PRIVATE_KEY_PATH", OCI_PRIVATE_KEY_PATH],
    ["OCI_NAMESPACE", OCI_NAMESPACE],
    ["OCI_BUCKET", OCI_BUCKET],
  ].filter(([, v]) => !v);

  if (missing.length) {
    console.warn(
      `Object Storage disabled — set ${missing.map(([k]) => k).join(", ")} in .env to enable uploads to ${OCI_BUCKET || "pt-app"}`,
    );
    enabled = false;
    return;
  }

  const keyPath = path.resolve(__dirname, OCI_PRIVATE_KEY_PATH);
  if (!fs.existsSync(keyPath)) {
    console.warn(`Object Storage disabled — private key not found at ${keyPath}`);
    enabled = false;
    return;
  }

  const privateKey = fs.readFileSync(keyPath, "utf8");
  const provider = new common.SimpleAuthenticationDetailsProvider(
    OCI_TENANCY_ID,
    OCI_USER_ID,
    OCI_FINGERPRINT,
    privateKey,
    process.env.OCI_PRIVATE_KEY_PASSPHRASE || null,
    common.Region.fromRegionId(OCI_REGION || "us-chicago-1"),
  );

  client = new objectstorage.ObjectStorageClient({ authenticationDetailsProvider: provider });
  enabled = true;
  console.log(`Object Storage ready → ${OCI_NAMESPACE}/${OCI_BUCKET}`);
}

export function storageEnabled() {
  return enabled;
}

export async function putJson(objectName, data) {
  if (!enabled) return { skipped: true, reason: "storage_disabled" };

  const namespaceName = process.env.OCI_NAMESPACE;
  const bucketName = process.env.OCI_BUCKET || "pt-app";
  const body = Buffer.from(JSON.stringify(data, null, 2), "utf8");

  await client.putObject({
    namespaceName,
    bucketName,
    objectName,
    putObjectBody: body,
    contentType: "application/json",
    contentLength: body.length,
  });

  return {
    skipped: false,
    bucket: bucketName,
    objectName,
    uri: `oci://${bucketName}@${namespaceName}/${objectName}`,
  };
}
