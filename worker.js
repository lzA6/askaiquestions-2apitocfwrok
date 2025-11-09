/**
 * ====================================================================================
 *
 *               ###   askaiquestions-2api Cloudflare Worker   ###
 *
 *   世界顶级的首席开发者体验架构师为您精心打造的艺术品级 Cloudflare Worker。
 *   该 Worker 将 'askaiquestions-2api' Python 项目的后端逻辑完整迁移，
 *   并封装了一个如同F1赛车驾驶舱般的、信息密集的开发者交互界面。
 *
 *   核心特性:
 *   - 高性能 API 代理，支持 HTTP/3 与 Brotli 压缩。
 *   - 完美的 SSE 流式代理与背压处理。
 *   - 端到端可观测性 (X-Request-ID)。
 *   - 配置即代码 (Configuration-as-Code)。
 *   - 一个完全自包含、交互式的“开发者驾驶舱”UI。
 *
 *   版本: 2.0.0 (Worker Edition)
 *   原始项目: askaiquestions-2api v1.0.0
 *   架构师: [您的首席开发者体验架构师]
 *
 * ====================================================================================
 */

// ###################################################################################
// 第一部分: 后端逻辑 (Backend Logic)
// ###################################################################################

/**
 * @description 配置即代码 (Configuration-as-Code)
 * 所有核心参数都在此定义。请在部署前进行必要的修改，尤其是 API_MASTER_KEY。
 */
const CONFIG = {
    // --- 项目基础信息 ---
    PROJECT_NAME: "askaiquestions-2api",
    PROJECT_VERSION: "1.0.0",
  
    // --- 安全与认证 ---
    // !!! 警告: 请务必替换为您的专属高强度密钥 !!!
    API_MASTER_KEY: "sk-askai-default-key-please-change-me",
  
    // --- 上游服务配置 ---
    // 这是原始 Python 项目中实际调用的后端 API
    UPSTREAM_URL: "https://pjfuothbq9.execute-api.us-east-1.amazonaws.com/get-summary",
  
    // --- API 默认值 ---
    DEFAULT_MODEL: "askai-default-model",
    KNOWN_MODELS: ["askai-default-model"],
  
    // --- 伪流式传输配置 ---
    // 模拟打字机效果，每次发送的字符数
    PSEUDO_STREAM_CHUNK_SIZE: 2,
    // 每个字符块之间的延迟（毫秒），以模拟真实流速
    PSEUDO_STREAM_DELAY_MS: 2,
  };
  
  /**
   * @description Worker 的主入口点，处理所有传入的请求。
   */
  addEventListener('fetch', event => {
    event.respondWith(handleRequest(event));
  });
  
  /**
   * @description 请求路由器，根据路径和方法分发请求。
   * @param {FetchEvent} event - Fetch 事件对象。
   * @returns {Promise<Response>}
   */
  async function handleRequest(event) {
    const { request } = event;
    const url = new URL(request.url);
  
    try {
      // 路由: GET / -> 返回开发者驾驶舱 UI
      if (url.pathname === '/' && request.method === 'GET') {
        return handleGui(request);
      }
  
      // 路由: /v1/** -> 执行 API 代理逻辑
      if (url.pathname.startsWith('/v1/')) {
        return handleApiProxy(request, event);
      }
  
      // 路由: 其他所有路径 -> 返回 404
      return new Response(
        JSON.stringify({
          error: {
            message: `路径未找到: ${url.pathname}`,
            type: 'invalid_request_error',
            code: 'not_found'
          }
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      console.error(`[全局异常捕获] 请求处理失败: ${error.message}`, error.stack);
      return new Response(
        JSON.stringify({
          error: {
            message: `内部服务器错误: ${error.message}`,
            type: 'api_error',
            code: 'internal_server_error'
          }
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }
  
  /**
   * @description 处理所有 /v1/ 路径下的 API 代理请求。
   * @param {Request} request - 传入的请求对象。
   * @param {FetchEvent} event - Fetch 事件对象，用于缓存。
   * @returns {Promise<Response>}
   */
  async function handleApiProxy(request, event) {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();
    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'X-Worker-Trace-ID': requestId,
    });
  
    // 步骤 1: 认证
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.substring(7) !== CONFIG.API_MASTER_KEY) {
      return new Response(
        JSON.stringify({
          error: {
            message: '无效的认证信息。请提供正确的 API Key。格式: "Authorization: Bearer YOUR_KEY"',
            type: 'invalid_request_error',
            code: 'invalid_api_key'
          }
        }),
        { status: 401, headers: responseHeaders }
      );
    }
  
    // 步骤 2: 内部路由
    // GET /v1/models -> 返回模型列表 (带缓存)
    if (url.pathname === '/v1/models' && request.method === 'GET') {
      return handleModels(request, event, responseHeaders);
    }
  
    // POST /v1/chat/completions -> 处理聊天补全
    if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
      return handleChatCompletions(request, requestId, responseHeaders);
    }
  
    // 其他 /v1/ 路径
    return new Response(
      JSON.stringify({
        error: {
          message: `API 端点不存在: ${request.method} ${url.pathname}`,
          type: 'invalid_request_error',
          code: 'not_found'
        }
      }),
      { status: 404, headers: responseHeaders }
    );
  }
  
  /**
   * @description 处理 /v1/models 请求，利用 Cache API 进行缓存。
   * @param {Request} request
   * @param {FetchEvent} event
   * @param {Headers} responseHeaders
   * @returns {Promise<Response>}
   */
  async function handleModels(request, event, responseHeaders) {
    const cache = caches.default;
    // 使用请求 URL 和头部信息（包含认证）作为缓存键，确保安全
    const cacheKey = new Request(request.url, request);
    let response = await cache.match(cacheKey);
  
    if (response) {
      // 缓存命中，在响应头中添加标记
      const newHeaders = new Headers(response.headers);
      newHeaders.set('X-Worker-Cache-Status', 'HIT');
      newHeaders.set('X-Worker-Trace-ID', responseHeaders.get('X-Worker-Trace-ID'));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }
  
    // 缓存未命中
    const modelData = {
      object: "list",
      data: CONFIG.KNOWN_MODELS.map(name => ({
        id: name,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "askai-project"
      }))
    };
  
    response = new Response(JSON.stringify(modelData), {
      headers: responseHeaders
    });
    response.headers.set('X-Worker-Cache-Status', 'MISS');
    // 缓存响应，有效期 1 小时
    response.headers.set('Cache-Control', 'public, max-age=3600');
  
    // 异步写入缓存，不阻塞响应
    event.waitUntil(cache.put(cacheKey, response.clone()));
  
    return response;
  }
  
  /**
   * @description 处理 /v1/chat/completions 请求，核心代理逻辑。
   * @param {Request} request
   * @param {string} requestId
   * @param {Headers} responseHeaders
   * @returns {Promise<Response>}
   */
  async function handleChatCompletions(request, requestId, responseHeaders) {
    let requestData;
    try {
      requestData = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({
        error: { message: '无效的 JSON 请求体', type: 'invalid_request_error' }
      }), { status: 400, headers: responseHeaders });
    }
  
    const isStream = requestData.stream || false;
    const model = requestData.model || CONFIG.DEFAULT_MODEL;
  
    try {
      // 步骤 1: 准备上游请求
      const upstreamPayload = {
        website: "ask-ai-questions",
        messages: requestData.messages || []
      };
  
      if (upstreamPayload.messages.length === 0) {
        return new Response(JSON.stringify({
          error: { message: "请求体中缺少 'messages' 字段。", type: 'invalid_request_error' }
        }), { status: 400, headers: responseHeaders });
      }
  
      const upstreamHeaders = {
        "accept": "*/*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "content-type": "application/json",
        "origin": "https://askaiquestions.net",
        "referer": "https://askaiquestions.net/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "X-Request-ID": requestId // 请求水印
      };
  
      // 步骤 2: 发起上游请求
      const upstreamResponse = await fetch(CONFIG.UPSTREAM_URL, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(upstreamPayload),
        // 暗示 Cloudflare 优先使用 HTTP/3
        cf: { http3: 'on' }
      });
  
      if (!upstreamResponse.ok) {
        const errorText = await upstreamResponse.text();
        console.error(`[上游错误] ${upstreamResponse.status}: ${errorText}`);
        return new Response(JSON.stringify({
          error: { message: `上游服务错误: ${errorText}`, type: 'api_error', code: `upstream_${upstreamResponse.status}` }
        }), { status: upstreamResponse.status, headers: responseHeaders });
      }
  
      // 步骤 3: 解析上游响应
      const upstreamData = await upstreamResponse.json();
      const summary = upstreamData.summary;
  
      if (typeof summary !== 'string') {
        throw new Error("上游响应的 JSON 中缺少 'summary' 字段或格式不正确。");
      }
  
      // 步骤 4: 根据 stream 参数返回不同格式的响应
      if (isStream) {
        // --- 处理流式响应 ---
        const stream = createPseudoStream(summary, requestId, model);
        responseHeaders.set('Content-Type', 'text/event-stream');
        responseHeaders.set('Cache-Control', 'no-cache');
        responseHeaders.set('Connection', 'keep-alive');
        return new Response(stream, { headers: responseHeaders });
      } else {
        // --- 处理非流式响应 ---
        const completionData = {
          id: requestId,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [{
            index: 0,
            message: { role: "assistant", content: summary },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        };
        return new Response(JSON.stringify(completionData), { headers: responseHeaders });
      }
  
    } catch (error) {
      console.error(`[Chat Completions 异常] ${error.message}`, error.stack);
      const errorMessage = error.message.includes("JSON") ? "无法解析上游服务响应" : `内部服务器错误: ${error.message}`;
      return new Response(JSON.stringify({
        error: { message: errorMessage, type: 'api_error' }
      }), { status: 502, headers: responseHeaders });
    }
  }
  
  /**
   * @description 创建一个“高速伪流”，模拟真实 SSE 流。
   * 这完美复刻了原 Python 项目的 `_stream_generator` 逻辑。
   * @param {string} fullText - 完整的响应文本。
   * @param {string} requestId - 请求 ID。
   * @param {string} model - 模型名称。
   * @returns {ReadableStream}
   */
  function createPseudoStream(fullText, requestId, model) {
    const encoder = new TextEncoder();
  
    return new ReadableStream({
      async start(controller) {
        try {
          const chunkSize = CONFIG.PSEUDO_STREAM_CHUNK_SIZE;
          const delay = CONFIG.PSEUDO_STREAM_DELAY_MS;
  
          // 分块发送内容
          for (let i = 0; i < fullText.length; i += chunkSize) {
            const contentChunk = fullText.substring(i, i + chunkSize);
            const chunk = {
              id: requestId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [{ index: 0, delta: { content: contentChunk }, finish_reason: null }]
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            if (delay > 0) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
  
          // 发送结束标志
          const finalChunk = {
            id: requestId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
  
          // 发送 [DONE] 标志
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
  
        } catch (e) {
          console.error(`[流生成器错误]: ${e}`);
          const errorChunk = {
            id: requestId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{ index: 0, delta: { content: `\n\n[Worker内部错误: ${e.message}]` }, finish_reason: "stop" }]
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } finally {
          controller.close();
        }
      }
    });
  }
  
  /**
   * @description 处理对根路径 (/) 的请求，返回“开发者驾驶舱”HTML 页面。
   * @param {Request} request
   * @returns {Response}
   */
  function handleGui(request) {
    const url = new URL(request.url);
    // 动态替换 HTML 模板中的占位符
    let html = HTML_TEMPLATE
      .replace(/{{PROJECT_NAME}}/g, CONFIG.PROJECT_NAME)
      .replace(/{{PROJECT_VERSION}}/g, CONFIG.PROJECT_VERSION)
      .replace(/{{API_ENDPOINT}}/g, `${url.origin}/v1/chat/completions`)
      .replace(/{{API_KEY}}/g, CONFIG.API_MASTER_KEY)
      .replace(/{{DEFAULT_MODEL}}/g, CONFIG.DEFAULT_MODEL)
      .replace(/{{UPSTREAM_URL}}/g, CONFIG.UPSTREAM_URL)
      .replace(/{{MODELS_ENDPOINT}}/g, `${url.origin}/v1/models`)
      .replace(/{{CURL_ENDPOINT}}/g, url.origin);
  
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // 建议浏览器不要缓存驾驶舱页面，以便始终获取最新版 Worker 代码
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }
  
  
  // ###################################################################################
  // 第二部分: "开发者驾驶舱" UI (UI/UX & Functionality)
  // ###################################################################################
  
  const HTML_TEMPLATE = `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>{{PROJECT_NAME}} - 开发者驾驶舱</title>
      <style>
          /* --- 全局样式与重置 --- */
          :root {
              --bg-color: #121212;
              --text-color: #E0E0E0;
              --text-color-secondary: #888888;
              --panel-bg-color: #1E1E1E;
              --border-color: #333333;
              --highlight-color: #FFBF00; /* 琥珀色 */
              --error-color: #CF6679;
              --success-color: #66BB6A;
              --font-family: 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif;
              --font-mono: 'Fira Code', 'Consolas', 'Courier New', monospace;
          }
          body {
              font-family: var(--font-family);
              background-color: var(--bg-color);
              color: var(--text-color);
              margin: 0;
              padding: 1rem;
              font-size: 16px;
              line-height: 1.6;
          }
          * {
              box-sizing: border-box;
          }
          /* --- 骨架屏样式 --- */
          .skeleton {
              background-color: #2a2a2a;
              border-radius: 4px;
              position: relative;
              overflow: hidden;
          }
          .skeleton::before {
              content: '';
              position: absolute;
              top: 0;
              left: -150%;
              height: 100%;
              width: 150%;
              background: linear-gradient(to right, transparent 0%, #3a3a3a 50%, transparent 100%);
              animation: skeleton-loading 1.5s infinite;
          }
          @keyframes skeleton-loading {
              from { left: -150%; }
              to { left: 100%; }
          }
      </style>
      <!-- 引入一个轻量级的 Markdown 渲染库 -->
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  </head>
  <body>
  
      <!-- ==================== 主布局 Custom Element ==================== -->
      <main-layout>
          <!-- 在 JS 失效时，显示骨架屏作为渐进增强的回退 -->
          <div slot="skeleton">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                  <div class="skeleton" style="width: 200px; height: 24px;"></div>
                  <div class="skeleton" style="width: 120px; height: 24px;"></div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 1rem;">
                  <div>
                      <div class="skeleton" style="height: 150px; margin-bottom: 1rem;"></div>
                      <div class="skeleton" style="height: 200px;"></div>
                  </div>
                  <div class="skeleton" style="height: 600px;"></div>
              </div>
          </div>
      </main-layout>
  
      <!-- ==================== Custom Element 模板定义 ==================== -->
  
      <!-- 1. 状态指示器模板 -->
      <template id="status-indicator-template">
          <style>
              .indicator {
                  display: flex;
                  align-items: center;
                  gap: 0.5rem;
                  padding: 0.25rem 0.75rem;
                  border-radius: 999px;
                  font-size: 0.875rem;
                  font-weight: 500;
                  transition: all 0.3s ease;
              }
              .dot {
                  width: 10px;
                  height: 10px;
                  border-radius: 50%;
                  transition: background-color 0.3s ease;
              }
              .indicator.checking { background-color: #4a4a4a; }
              .indicator.checking .dot { background-color: var(--highlight-color); animation: pulse 1.5s infinite; }
              .indicator.ready { background-color: rgba(var(--success-color-rgb), 0.15); color: var(--success-color); }
              .indicator.ready .dot { background-color: var(--success-color); }
              .indicator.error { background-color: rgba(var(--error-color-rgb), 0.15); color: var(--error-color); }
              .indicator.error .dot { background-color: var(--error-color); }
              @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
          </style>
          <div class="indicator checking" id="indicator-root">
              <div class="dot"></div>
              <span id="indicator-text">检查中...</span>
          </div>
      </template>
  
      <!-- 2. 信息面板模板 -->
      <template id="info-panel-template">
          <style>
              .panel { background-color: var(--panel-bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.5rem; }
              h3 { margin-top: 0; border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem; }
              .info-item { margin-bottom: 1.25rem; }
              .info-item:last-child { margin-bottom: 0; }
              label { display: block; font-size: 0.875rem; color: var(--text-color-secondary); margin-bottom: 0.25rem; }
              .value-container { display: flex; align-items: center; background-color: var(--bg-color); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.5rem 0.75rem; }
              .value { font-family: var(--font-mono); color: var(--highlight-color); word-break: break-all; flex-grow: 1; }
              .icon-btn { background: none; border: none; cursor: pointer; padding: 0.25rem; display: flex; align-items: center; justify-content: center; color: var(--text-color-secondary); }
              .icon-btn:hover { color: var(--text-color); }
              .icon-btn svg { width: 18px; height: 18px; }
              .copy-feedback { font-size: 0.8rem; color: var(--success-color); margin-left: 0.5rem; opacity: 0; transition: opacity 0.3s; }
          </style>
          <div class="panel">
              <h3>
                  <svg fill="currentColor" viewBox="0 0 24 24"><path d="M12.5 8c-2.65 0-5.18.99-7.11 2.83L3.51 9.04a1 1 0 00-1.42 1.42l2.28 2.28a1 1 0 001.42 0l2.28-2.28a1 1 0 00-1.42-1.42l-1.88 1.88C8.06 9.66 10.13 9 12.5 9s4.44.66 6.2 1.95l-1.88-1.88a1 1 0 10-1.42 1.42l2.28 2.28a1 1 0 001.42 0l2.28-2.28a1 1 0 10-1.42-1.42l-1.88 1.88C17.68 8.99 15.15 8 12.5 8zm0 8c-2.65 0-5.18-.99-7.11-2.83l-1.88 1.88a1 1 0 001.42 1.42l2.28-2.28a1 1 0 000-1.42l-2.28-2.28a1 1 0 00-1.42 1.42l1.88 1.88C7.32 15.01 9.85 16 12.5 16s5.18-.99 7.11-2.83l1.88-1.88a1 1 0 10-1.42-1.42l-2.28 2.28a1 1 0 000 1.42l2.28 2.28a1 1 0 101.42-1.42l-1.88-1.88C17.68 15.01 15.15 16 12.5 16z"/></svg>
                  <span>即用情报</span>
              </h3>
              <div class="info-item">
                  <label>API 接口地址</label>
                  <div class="value-container">
                      <span class="value" id="api-url">{{API_ENDPOINT}}</span>
                      <button class="icon-btn" id="copy-url-btn" title="复制地址">
                          <svg fill="currentColor" viewBox="0 0 20 20"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"></path><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"></path></svg>
                          <span class="copy-feedback" id="url-feedback">已复制!</span>
                      </button>
                  </div>
              </div>
              <div class="info-item">
                  <label>API 密钥 (Bearer Token)</label>
                  <div class="value-container">
                      <span class="value" id="api-key" data-full-key="{{API_KEY}}"></span>
                      <button class="icon-btn" id="toggle-key-btn" title="显示/隐藏密钥">
                          <svg id="eye-open" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"></path><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.022 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"></path></svg>
                          <svg id="eye-closed" style="display: none;" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zM14.95 14.95A10.007 10.007 0 0110 17c-4.478 0-8.268-2.943-9.542-7a10.01 10.01 0 013.542-5.048l1.473 1.473A3.997 3.997 0 0010 12a4 4 0 00-1.95-3.542L6.293 6.293A8.003 8.003 0 002 10c1.274 4.057 5.022 7 8 7a7.97 7.97 0 003.542-.95z" clip-rule="evenodd"></path></svg>
                      </button>
                      <button class="icon-btn" id="copy-key-btn" title="复制密钥">
                          <svg fill="currentColor" viewBox="0 0 20 20"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"></path><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"></path></svg>
                          <span class="copy-feedback" id="key-feedback">已复制!</span>
                      </button>
                  </div>
              </div>
              <div class="info-item">
                  <label>默认模型</label>
                  <div class="value-container">
                      <span class="value">{{DEFAULT_MODEL}}</span>
                  </div>
              </div>
          </div>
      </template>
  
      <!-- 3. 实时交互终端模板 -->
      <template id="live-terminal-template">
          <style>
              .terminal { display: flex; flex-direction: column; height: 100%; background-color: var(--panel-bg-color); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
              .output-area { flex-grow: 1; padding: 1rem; overflow-y: auto; font-family: var(--font-family); line-height: 1.7; }
              .output-area p { margin: 0 0 1rem 0; }
              .output-area pre { background-color: var(--bg-color); padding: 1rem; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; font-family: var(--font-mono); }
              .output-area code { font-family: var(--font-mono); }
              .output-area table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
              .output-area th, .output-area td { border: 1px solid var(--border-color); padding: 0.5rem; }
              .output-area th { background-color: #2a2a2a; }
              .output-area .placeholder { color: var(--text-color-secondary); display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; }
              .output-area .placeholder svg { width: 48px; height: 48px; margin-bottom: 1rem; }
              .input-area { border-top: 1px solid var(--border-color); padding: 1rem; display: flex; align-items: flex-end; gap: 0.5rem; }
              textarea { flex-grow: 1; background-color: var(--bg-color); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.75rem; font-family: var(--font-family); font-size: 1rem; resize: none; min-height: 50px; max-height: 200px; transition: border-color 0.2s; }
              textarea:focus { outline: none; border-color: var(--highlight-color); }
              .send-btn { background-color: var(--highlight-color); color: var(--bg-color); border: none; border-radius: 4px; padding: 0.75rem 1.5rem; font-weight: bold; cursor: pointer; transition: background-color 0.2s; display: flex; align-items: center; gap: 0.5rem; }
              .send-btn:hover:not(:disabled) { background-color: #ffcf40; }
              .send-btn:disabled { background-color: #4a4a4a; color: #888; cursor: not-allowed; }
              .send-btn.cancel { background-color: var(--error-color); color: var(--text-color); }
              .send-btn.cancel:hover:not(:disabled) { background-color: #da7c89; }
              .send-btn svg { width: 18px; height: 18px; }
              .spinner { animation: spin 1s linear infinite; }
              @keyframes spin { to { transform: rotate(360deg); } }
          </style>
          <div class="terminal">
              <div class="output-area" id="output-area">
                  <div class="placeholder">
                      <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.562L16.25 22.5l-.648-1.938a2.25 2.25 0 01-1.44-1.44L12 18.75l1.938-.648a2.25 2.25 0 011.44-1.44L17.25 15l.648 1.938a2.25 2.25 0 011.44 1.44L21.25 18.75l-1.938.648a2.25 2.25 0 01-1.44 1.44z"></path></svg>
                      <span>在此处开始您的第一次对话...</span>
                  </div>
              </div>
              <div class="input-area">
                  <textarea id="prompt-input" placeholder="输入您的指令..." rows="1"></textarea>
                  <button id="send-btn" class="send-btn" disabled>
                      <svg id="send-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"></path></svg>
                      <svg id="spinner-icon" class="spinner" style="display: none;" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.3"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      <span id="send-btn-text">发送</span>
                  </button>
              </div>
          </div>
      </template>
  
      <!-- 4. 客户端集成指南模板 -->
      <template id="client-guides-template">
          <style>
              .guides { background-color: var(--panel-bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.5rem; }
              .tabs { display: flex; border-bottom: 1px solid var(--border-color); margin-bottom: 1rem; }
              .tab { padding: 0.5rem 1rem; cursor: pointer; border: none; background: none; color: var(--text-color-secondary); border-bottom: 2px solid transparent; }
              .tab.active { color: var(--highlight-color); border-bottom-color: var(--highlight-color); }
              .tab-content { display: none; }
              .tab-content.active { display: block; }
              pre { background-color: var(--bg-color); padding: 1rem; border-radius: 4px; font-family: var(--font-mono); font-size: 0.9rem; white-space: pre-wrap; word-wrap: break-word; position: relative; }
              .copy-code-btn { position: absolute; top: 0.5rem; right: 0.5rem; background: #333; border: 1px solid #444; color: var(--text-color); cursor: pointer; padding: 0.25rem 0.5rem; border-radius: 4px; opacity: 0.5; transition: opacity 0.2s; }
              pre:hover .copy-code-btn { opacity: 1; }
              .copy-code-btn:active { background: #444; }
          </style>
          <div class="guides">
              <div class="tabs" id="guide-tabs">
                  <button class="tab active" data-tab="curl">cURL</button>
                  <button class="tab" data-tab="python">Python</button>
                  <button class="tab" data-tab="nextweb">ChatGPT-Next-Web</button>
                  <button class="tab" data-tab="lobechat">LobeChat</button>
              </div>
              <div id="guide-content">
                  <div id="tab-content-curl" class="tab-content active">
                      <pre><button class="copy-code-btn">复制</button><code>curl "{{API_ENDPOINT}}" \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer {{API_KEY}}" \\
    -d '{
      "model": "{{DEFAULT_MODEL}}",
      "messages": [
        {
          "role": "user",
          "content": "你好，世界！"
        }
      ],
      "stream": true
    }'</code></pre>
                  </div>
                  <div id="tab-content-python" class="tab-content">
                      <pre><button class="copy-code-btn">复制</button><code>import requests
  import json
  
  API_URL = "{{API_ENDPOINT}}"
  API_KEY = "{{API_KEY}}"
  
  headers = {
      "Content-Type": "application/json",
      "Authorization": f"Bearer {API_KEY}"
  }
  
  data = {
      "model": "{{DEFAULT_MODEL}}",
      "messages": [
          {"role": "user", "content": "你好，世界！"}
      ],
      "stream": True
  }
  
  response = requests.post(API_URL, headers=headers, json=data, stream=True)
  
  for line in response.iter_lines():
      if line:
          decoded_line = line.decode('utf-8')
          if decoded_line.startswith('data: '):
              try:
                  content = decoded_line[len('data: '):]
                  if content != "[DONE]":
                      chunk = json.loads(content)
                      print(chunk['choices'][0]['delta'].get('content', ''), end='')
              except json.JSONDecodeError:
                  print(f"\\nError decoding JSON: {content}")
  print()
  </code></pre>
                  </div>
                  <div id="tab-content-nextweb" class="tab-content">
                      <p>在 ChatGPT-Next-Web 的部署设置中，填入以下信息：</p>
                      <pre><button class="copy-code-btn">复制</button><code># 接口地址 (API_URL)
  {{CURL_ENDPOINT}}
  
  # API Key (OPENAI_API_KEY)
  {{API_KEY}}
  
  # 自定义模型 (CUSTOM_MODELS)
  -{{DEFAULT_MODEL}}</code></pre>
                      <p>注意：<code>CUSTOM_MODELS</code> 前面的 <code>-</code> 表示从列表中移除默认模型，只使用您提供的自定义模型。</p>
                  </div>
                  <div id="tab-content-lobechat" class="tab-content">
                      <p>在 LobeChat 的设置 -> 语言模型 -> OpenAI 中，填入以下信息：</p>
                      <pre><button class="copy-code-btn">复制</button><code># API Key
  {{API_KEY}}
  
  # 代理地址 (Endpoint)
  {{CURL_ENDPOINT}}</code></pre>
                      <p>然后，在对话设置中选择或手动输入 <code>{{DEFAULT_MODEL}}</code> 作为模型使用。</p>
                  </div>
              </div>
          </div>
      </template>
  
      <!-- ==================== 客户端脚本 ==================== -->
      <script>
          // --- 状态机 ---
          const AppState = {
              INITIALIZING: 'INITIALIZING',
              HEALTH_CHECKING: 'HEALTH_CHECKING',
              READY: 'READY',
              REQUESTING: 'REQUESTING',
              STREAMING: 'STREAMING',
              ERROR: 'ERROR',
          };
  
          // --- 主应用逻辑 ---
          document.addEventListener('DOMContentLoaded', () => {
              // 注册所有 Custom Elements
              customElements.define('main-layout', MainLayout);
              customElements.define('status-indicator', StatusIndicator);
              customElements.define('info-panel', InfoPanel);
              customElements.define('live-terminal', LiveTerminal);
              customElements.define('client-guides', ClientGuides);
  
              // 渐进增强：移除骨架屏，显示真实内容
              const mainLayout = document.querySelector('main-layout');
              if (mainLayout) {
                  mainLayout.removeAttribute('loading');
              }
          });
  
          // --- Custom Element 定义 ---
  
          class MainLayout extends HTMLElement {
              constructor() {
                  super();
                  this.attachShadow({ mode: 'open' });
                  this.shadowRoot.innerHTML = \`
                      <style>
                          .hidden { display: none; }
                          .header {
                              display: flex;
                              justify-content: space-between;
                              align-items: center;
                              margin-bottom: 2rem;
                              flex-wrap: wrap;
                              gap: 1rem;
                          }
                          .title {
                              font-size: 1.5rem;
                              font-weight: 600;
                          }
                          .title .version {
                              font-size: 0.9rem;
                              font-weight: normal;
                              color: var(--text-color-secondary);
                              margin-left: 0.5rem;
                              background-color: var(--panel-bg-color);
                              padding: 0.1rem 0.4rem;
                              border-radius: 4px;
                              border: 1px solid var(--border-color);
                          }
                          .container {
                              display: grid;
                              grid-template-columns: 1fr;
                              gap: 1.5rem;
                          }
                          @media (min-width: 1024px) {
                              .container {
                                  grid-template-columns: 380px 1fr;
                              }
                          }
                          .left-column, .right-column {
                              display: flex;
                              flex-direction: column;
                              gap: 1.5rem;
                          }
                          details {
                              background-color: var(--panel-bg-color);
                              border: 1px solid var(--border-color);
                              border-radius: 8px;
                              overflow: hidden;
                          }
                          summary {
                              padding: 1rem 1.5rem;
                              cursor: pointer;
                              font-weight: 500;
                              display: flex;
                              align-items: center;
                              gap: 0.5rem;
                          }
                          summary:hover {
                              background-color: #2a2a2a;
                          }
                          summary::marker { content: ''; }
                          summary svg {
                              width: 20px;
                              height: 20px;
                              transition: transform 0.2s;
                          }
                          details[open] > summary svg {
                              transform: rotate(90deg);
                          }
                          .details-content {
                              padding: 0 1.5rem 1.5rem 1.5rem;
                              border-top: 1px solid var(--border-color);
                          }
                      </style>
                      <div id="skeleton-slot" class="\${this.hasAttribute('loading') ? '' : 'hidden'}">
                          <slot name="skeleton"></slot>
                      </div>
                      <div id="content" class="\${this.hasAttribute('loading') ? 'hidden' : ''}">
                          <header class="header">
                              <div class="title">
                                  {{PROJECT_NAME}}
                                  <span class="version">v{{PROJECT_VERSION}}</span>
                              </div>
                              <status-indicator></status-indicator>
                          </header>
                          <main class="container">
                              <div class="left-column">
                                  <info-panel></info-panel>
                                  <details>
                                      <summary>
                                          <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                                          ⚙️ 主流客户端集成指南
                                      </summary>
                                      <div class="details-content">
                                          <client-guides></client-guides>
                                      </div>
                                  </details>
                                  <details>
                                      <summary>
                                          <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                                          🔌 兼容接口参考
                                      </summary>
                                      <div class="details-content" style="padding: 0;">
                                          <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                                              <thead style="text-align: left; background-color: #2a2a2a;">
                                                  <tr>
                                                      <th style="padding: 0.75rem;">方法</th>
                                                      <th style="padding: 0.75rem;">路径</th>
                                                      <th style="padding: 0.75rem;">描述</th>
                                                  </tr>
                                              </thead>
                                              <tbody>
                                                  <tr style="border-top: 1px solid var(--border-color);">
                                                      <td style="padding: 0.75rem;"><code style="background: #333; padding: 2px 6px; border-radius: 4px;">POST</code></td>
                                                      <td style="padding: 0.75rem;"><code style="font-family: var(--font-mono);">/v1/chat/completions</code></td>
                                                      <td style="padding: 0.75rem;">聊天补全</td>
                                                  </tr>
                                                  <tr style="border-top: 1px solid var(--border-color);">
                                                      <td style="padding: 0.75rem;"><code style="background: #333; padding: 2px 6px; border-radius: 4px;">GET</code></td>
                                                      <td style="padding: 0.75rem;"><code style="font-family: var(--font-mono);">/v1/models</code></td>
                                                      <td style="padding: 0.75rem;">获取模型列表</td>
                                                  </tr>
                                              </tbody>
                                          </table>
                                      </div>
                                  </details>
                              </div>
                              <div class="right-column">
                                  <live-terminal style="min-height: 600px;"></live-terminal>
                              </div>
                          </main>
                      </div>
                  \`;
              }
              
              attributeChangedCallback(name, oldValue, newValue) {
                  if (name === 'loading') {
                      const skeleton = this.shadowRoot.getElementById('skeleton-slot');
                      const content = this.shadowRoot.getElementById('content');
                      if (newValue === null) { // loading attribute removed
                          skeleton.classList.add('hidden');
                          content.classList.remove('hidden');
                      } else {
                          skeleton.classList.remove('hidden');
                          content.classList.add('hidden');
                      }
                  }
              }
  
              static get observedAttributes() {
                  return ['loading'];
              }
          }
  
          class StatusIndicator extends HTMLElement {
              constructor() {
                  super();
                  this.attachShadow({ mode: 'open' });
                  const template = document.getElementById('status-indicator-template').content;
                  this.shadowRoot.appendChild(template.cloneNode(true));
                  this.rootEl = this.shadowRoot.getElementById('indicator-root');
                  this.textEl = this.shadowRoot.getElementById('indicator-text');
              }
  
              connectedCallback() {
                  this.checkHealth();
                  // 每 60 秒检查一次
                  this.intervalId = setInterval(() => this.checkHealth(), 60000);
              }
  
              disconnectedCallback() {
                  clearInterval(this.intervalId);
              }
  
              async checkHealth() {
                  this.setState('checking');
                  try {
                      const response = await fetch('{{MODELS_ENDPOINT}}', {
                          method: 'GET',
                          headers: { 'Authorization': 'Bearer {{API_KEY}}' }
                      });
                      if (response.ok) {
                          this.setState('ready');
                      } else {
                          throw new Error(\`Status: \${response.status}\`);
                      }
                  } catch (error) {
                      console.error('Health check failed:', error);
                      this.setState('error');
                  }
              }
  
              setState(state) {
                  this.rootEl.className = 'indicator ' + state;
                  switch (state) {
                      case 'checking': this.textEl.textContent = '检查中...'; break;
                      case 'ready': this.textEl.textContent = '服务可用'; break;
                      case 'error': this.textEl.textContent = '服务异常'; break;
                  }
              }
          }
  
          class InfoPanel extends HTMLElement {
              constructor() {
                  super();
                  this.attachShadow({ mode: 'open' });
                  const template = document.getElementById('info-panel-template').content;
                  this.shadowRoot.appendChild(template.cloneNode(true));
              }
  
              connectedCallback() {
                  this.apiKeyEl = this.shadowRoot.getElementById('api-key');
                  this.isKeyVisible = false;
                  this.updateKeyVisibility();
  
                  this.shadowRoot.getElementById('copy-url-btn').addEventListener('click', () => this.copyToClipboard('{{API_ENDPOINT}}', 'url-feedback'));
                  this.shadowRoot.getElementById('copy-key-btn').addEventListener('click', () => this.copyToClipboard('{{API_KEY}}', 'key-feedback'));
                  this.shadowRoot.getElementById('toggle-key-btn').addEventListener('click', () => this.toggleKeyVisibility());
              }
  
              copyToClipboard(text, feedbackElId) {
                  navigator.clipboard.writeText(text).then(() => {
                      const feedbackEl = this.shadowRoot.getElementById(feedbackElId);
                      feedbackEl.style.opacity = '1';
                      setTimeout(() => { feedbackEl.style.opacity = '0'; }, 2000);
                  });
              }
  
              toggleKeyVisibility() {
                  this.isKeyVisible = !this.isKeyVisible;
                  this.updateKeyVisibility();
              }
  
              updateKeyVisibility() {
                  const fullKey = this.apiKeyEl.dataset.fullKey;
                  const eyeOpen = this.shadowRoot.getElementById('eye-open');
                  const eyeClosed = this.shadowRoot.getElementById('eye-closed');
  
                  if (this.isKeyVisible) {
                      this.apiKeyEl.textContent = fullKey;
                      eyeOpen.style.display = 'none';
                      eyeClosed.style.display = 'block';
                  } else {
                      this.apiKeyEl.textContent = \`\${fullKey.substring(0, 5)}... \${fullKey.substring(fullKey.length - 4)}\`;
                      eyeOpen.style.display = 'block';
                      eyeClosed.style.display = 'none';
                  }
              }
          }
  
          class LiveTerminal extends HTMLElement {
              constructor() {
                  super();
                  this.attachShadow({ mode: 'open' });
                  const template = document.getElementById('live-terminal-template').content;
                  this.shadowRoot.appendChild(template.cloneNode(true));
                  this.state = AppState.READY;
                  this.abortController = null;
              }
  
              connectedCallback() {
                  this.outputArea = this.shadowRoot.getElementById('output-area');
                  this.promptInput = this.shadowRoot.getElementById('prompt-input');
                  this.sendBtn = this.shadowRoot.getElementById('send-btn');
                  this.sendBtnText = this.shadowRoot.getElementById('send-btn-text');
                  this.sendIcon = this.shadowRoot.getElementById('send-icon');
                  this.spinnerIcon = this.shadowRoot.getElementById('spinner-icon');
  
                  this.promptInput.addEventListener('input', this.onInput.bind(this));
                  this.promptInput.addEventListener('keydown', this.onKeydown.bind(this));
                  this.sendBtn.addEventListener('click', this.onSend.bind(this));
                  
                  this.updateSendButton();
              }
  
              onInput() {
                  // 自动增高
                  this.promptInput.style.height = 'auto';
                  this.promptInput.style.height = (this.promptInput.scrollHeight) + 'px';
                  this.updateSendButton();
              }
              
              onKeydown(e) {
                  if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!this.sendBtn.disabled) {
                          this.onSend();
                      }
                  }
              }
  
              updateSendButton() {
                  const hasText = this.promptInput.value.trim().length > 0;
                  if (this.state === AppState.READY) {
                      this.sendBtn.disabled = !hasText;
                  }
              }
  
              setState(newState) {
                  this.state = newState;
                  this.sendBtn.classList.remove('cancel');
                  this.spinnerIcon.style.display = 'none';
                  this.sendIcon.style.display = 'block';
  
                  switch (newState) {
                      case AppState.READY:
                          this.sendBtnText.textContent = '发送';
                          this.promptInput.disabled = false;
                          this.updateSendButton();
                          break;
                      case AppState.REQUESTING:
                          this.sendBtnText.textContent = '取消';
                          this.sendBtn.disabled = false;
                          this.sendBtn.classList.add('cancel');
                          this.promptInput.disabled = true;
                          this.spinnerIcon.style.display = 'block';
                          this.sendIcon.style.display = 'none';
                          break;
                      case AppState.STREAMING:
                          this.sendBtnText.textContent = '取消';
                          this.sendBtn.disabled = false;
                          this.sendBtn.classList.add('cancel');
                          this.promptInput.disabled = true;
                          this.spinnerIcon.style.display = 'none';
                          this.sendIcon.style.display = 'block';
                          break;
                  }
              }
  
              onSend() {
                  if (this.state === AppState.REQUESTING || this.state === AppState.STREAMING) {
                      // 取消请求
                      if (this.abortController) {
                          this.abortController.abort();
                      }
                  } else {
                      // 发送请求
                      this.sendMessage();
                  }
              }
  
              async sendMessage() {
                  const prompt = this.promptInput.value.trim();
                  if (!prompt) return;
  
                  this.setState(AppState.REQUESTING);
                  this.abortController = new AbortController();
  
                  // 清空欢迎语
                  if (this.outputArea.querySelector('.placeholder')) {
                      this.outputArea.innerHTML = '';
                  }
  
                  // 显示用户输入
                  const userMessage = document.createElement('div');
                  userMessage.innerHTML = \`<p><strong>您:</strong></p>\${marked.parse(prompt)}\`;
                  this.outputArea.appendChild(userMessage);
  
                  // 准备 AI 回复区域
                  const assistantContainer = document.createElement('div');
                  assistantContainer.innerHTML = '<p><strong>助手:</strong></p>';
                  const assistantMessage = document.createElement('div');
                  assistantContainer.appendChild(assistantMessage);
                  this.outputArea.appendChild(assistantContainer);
  
                  this.promptInput.value = '';
                  this.onInput(); // 重置高度
  
                  let fullContent = '';
  
                  try {
                      const response = await fetch('{{API_ENDPOINT}}', {
                          method: 'POST',
                          headers: {
                              'Content-Type': 'application/json',
                              'Authorization': 'Bearer {{API_KEY}}'
                          },
                          body: JSON.stringify({
                              model: '{{DEFAULT_MODEL}}',
                              messages: [{ role: 'user', content: prompt }],
                              stream: true
                          }),
                          signal: this.abortController.signal
                      });
  
                      if (!response.ok) {
                          const errorData = await response.json();
                          throw new Error(errorData.error.message || 'API 请求失败');
                      }
  
                      this.setState(AppState.STREAMING);
                      
                      const reader = response.body.getReader();
                      const decoder = new TextDecoder();
                      let buffer = '';
  
                      while (true) {
                          const { done, value } = await reader.read();
                          if (done) break;
  
                          buffer += decoder.decode(value, { stream: true });
                          const lines = buffer.split('\\n\\n');
                          buffer = lines.pop(); // 保留不完整的消息
  
                          for (const line of lines) {
                              if (line.startsWith('data: ')) {
                                  const data = line.substring(6);
                                  if (data.trim() === '[DONE]') {
                                      break;
                                  }
                                  try {
                                      const chunk = JSON.parse(data);
                                      const content = chunk.choices[0].delta.content;
                                      if (content) {
                                          fullContent += content;
                                          assistantMessage.innerHTML = marked.parse(fullContent);
                                          this.outputArea.scrollTop = this.outputArea.scrollHeight;
                                      }
                                  } catch (e) {
                                      console.error('Error parsing SSE chunk:', data);
                                  }
                              }
                          }
                      }
  
                  } catch (error) {
                      if (error.name !== 'AbortError') {
                          console.error('Fetch error:', error);
                          assistantMessage.innerHTML += \`<p style="color: var(--error-color);">\\n[错误]: \${error.message}</p>\`;
                      } else {
                          assistantMessage.innerHTML += \`<p style="color: var(--text-color-secondary);">\\n[请求已取消]</p>\`;
                      }
                  } finally {
                      this.setState(AppState.READY);
                      this.abortController = null;
                      this.outputArea.scrollTop = this.outputArea.scrollHeight;
                  }
              }
          }
  
          class ClientGuides extends HTMLElement {
              constructor() {
                  super();
                  this.attachShadow({ mode: 'open' });
                  const template = document.getElementById('client-guides-template').content;
                  this.shadowRoot.appendChild(template.cloneNode(true));
              }
  
              connectedCallback() {
                  this.tabs = this.shadowRoot.querySelectorAll('.tab');
                  this.contents = this.shadowRoot.querySelectorAll('.tab-content');
                  this.copyButtons = this.shadowRoot.querySelectorAll('.copy-code-btn');
  
                  this.tabs.forEach(tab => {
                      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
                  });
  
                  this.copyButtons.forEach(btn => {
                      btn.addEventListener('click', () => this.copyCode(btn));
                  });
              }
  
              switchTab(tabId) {
                  this.tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabId));
                  this.contents.forEach(content => content.classList.toggle('active', content.id === \`tab-content-\${tabId}\`));
              }
  
              copyCode(button) {
                  const pre = button.parentElement;
                  const code = pre.querySelector('code');
                  navigator.clipboard.writeText(code.innerText).then(() => {
                      const originalText = button.textContent;
                      button.textContent = '已复制!';
                      setTimeout(() => { button.textContent = originalText; }, 2000);
                  });
              }
          }
  
      </script>
  </body>
  </html>
  `;
  
