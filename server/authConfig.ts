/**
 * 云端认证非对称公钥配置 (RS256 / ES256)
 *
 * 打包发布 (.exe) 说明：
 * 1. 私钥仅保存在您的 Cloudflare Worker 云端环境变量中，绝不写入本软件。
 * 2. 下方 EMBEDDED_JWT_PUBLIC_KEY 为与云端私钥配对的 RSA-2048 SPKI 公钥，可安全打包分发。
 * 3. 公钥仅能用于验证云端签发的 Token 是否合法与未过期，无法用于伪造 Token。
 */
export const EMBEDDED_JWT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0s5gFU5TfCr7mbuuC/96
EJJnEbuAC5Vw4+vqrXZrvvmiUZAAlULHV5kP6OFEJI3wXOGKAV5cqGezcYFT/P3m
I2mBLGqc0JHjCQZALb/GGluyCc1cmOiKbWDHgwFCd3fuCao0oborg7lzhg/Zy962
zKLUy9eFI5vyAwbYDbXiCNGbnJX6qeoZDJ6HyKC2kt1AOGj3UpNElh73dUnjsNlv
8ryJLqfq9IR6Xej8TDj2lxibCW3uUDCtb8UPQToweiHphflSc6v9ppNXM3l0rfZI
EYvpYe7IaRgd6AZJOMapvz7dY8ZoiqdgqUr33NxliQdDaUYakRDna+Fz+pt2cwgh
UwIDAQAB
-----END PUBLIC KEY-----`;
