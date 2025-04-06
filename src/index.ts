import app from "./app";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { getUnifiedPrice } from "./unified-price";

export class MyMCP extends McpAgent {
  server = new McpServer({
    name: "Demo",
    version: "1.0.0",
  });

  async init() {
    this.server.tool(
      "getUnifiedPrice",
      "获取统一价格接口，支持股票、基金、加密货币的价格查询，并可进行汇率转换",
      {
        code: z.string().describe(`
代码，支持以下格式：
- 股票代码：
  - A股：需要带上交易所后缀，如 600900.SS（上证）、000001.SZ（深证）
  - 美股：直接使用股票代码，如 AAPL、GOOGL
- 基金代码：6位数字，如 000001（华夏成长）
- 加密货币：支持常见代码，如 BTC、ETH、USDT
`),
        date: z
          .string()
          .optional()
          .describe("可选，查询日期，格式为 YYYY-MM-DD"),
        targetCurrency: z
          .string()
          .optional()
          .describe("可选，目标货币代码，如果提供则会进行汇率转换"),
      },
      async ({ code, date, targetCurrency }) => {
        const price = await getUnifiedPrice(code, date, targetCurrency);
        return {
          content: [{ type: "text", text: JSON.stringify(price) }],
        };
      }
    );
  }
}

// Export the OAuth handler as the default
export default new OAuthProvider({
  apiRoute: "/sse",
  // TODO: fix these types
  // @ts-ignore
  apiHandler: MyMCP.mount("/sse"),
  // @ts-ignore
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

export { getUnifiedPrice };
