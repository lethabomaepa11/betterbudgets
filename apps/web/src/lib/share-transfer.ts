"use client";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function createTransferPayload(source: string) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, encoder.encode(source));
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return { payload: toBase64Url(new Uint8Array(encrypted)), nonce: toBase64Url(nonce), secret: toBase64Url(rawKey) };
}

export async function decryptTransferPayload(payload: string, nonce: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", fromBase64Url(secret), { name: "AES-GCM" }, false, ["decrypt"]);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(nonce) }, key, fromBase64Url(payload));
  return decoder.decode(clear);
}
