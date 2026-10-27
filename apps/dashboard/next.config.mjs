/* global process */
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";
export default {
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${api.replace(/\/$/, "")}/v1/:path*` }];
  },
};
