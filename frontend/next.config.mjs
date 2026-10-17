/** @type {import('next').NextConfig} */
const nextConfig = {
  // MediaPipe Pose WASM cannot be constructed twice (React Strict Mode remounts
  // effects in dev and aborts with Module.arguments). Keep Strict Mode off.
  reactStrictMode: false,
};

export default nextConfig;
