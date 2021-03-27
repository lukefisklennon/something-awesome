const crypto = require("crypto");

const ecdh = crypto.createECDH("secp256k1");
ecdh.generateKeys();

const publicKey = ecdh.getPublicKey(null, "compressed");
const privateKey = ecdh.getPrivateKey(null, "compressed");

console.log("Private1:", privateKey.length, privateKey.toString("hex"));
console.log("Public1: ", publicKey.length, publicKey.toString("hex"));

const ecdh2 = crypto.createECDH("secp256k1");
ecdh2.generateKeys();

const publicKey2 = ecdh2.getPublicKey(null, "compressed");
const privateKey2 = ecdh2.getPrivateKey(null, "compressed");

console.log("Private2:", privateKey2.length, privateKey2.toString("hex"));
console.log("Public2: ", publicKey2.length, publicKey2.toString("hex"));

const secret = ecdh.computeSecret(publicKey2);
console.log("Secret1: ", secret.length, secret.toString("hex"));

const secret2 = ecdh2.computeSecret(publicKey);
console.log("Secret2: ", secret2.length, secret2.toString("hex"));