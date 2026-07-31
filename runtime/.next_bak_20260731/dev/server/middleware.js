"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "proxy";
exports.ids = ["proxy"];
exports.modules = {

/***/ "(middleware)/./node_modules/next/dist/build/webpack/loaders/next-middleware-loader.js?absolutePagePath=%2FUsers%2Fluyao%2FDocuments%2F%E5%9F%BA%E4%BA%8E%E6%9C%AC%E4%BD%93%E7%9A%84%E6%8A%95%E7%A0%94%E6%8E%A8%E7%90%86%E5%B9%B3%E5%8F%B0%2Fruntime%2Fproxy.ts&page=%2Fproxy&rootDir=%2FUsers%2Fluyao%2FDocuments%2F%E5%9F%BA%E4%BA%8E%E6%9C%AC%E4%BD%93%E7%9A%84%E6%8A%95%E7%A0%94%E6%8E%A8%E7%90%86%E5%B9%B3%E5%8F%B0%2Fruntime&matchers=&preferredRegion=&middlewareConfig=e30%3D!":
/*!********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-middleware-loader.js?absolutePagePath=%2FUsers%2Fluyao%2FDocuments%2F%E5%9F%BA%E4%BA%8E%E6%9C%AC%E4%BD%93%E7%9A%84%E6%8A%95%E7%A0%94%E6%8E%A8%E7%90%86%E5%B9%B3%E5%8F%B0%2Fruntime%2Fproxy.ts&page=%2Fproxy&rootDir=%2FUsers%2Fluyao%2FDocuments%2F%E5%9F%BA%E4%BA%8E%E6%9C%AC%E4%BD%93%E7%9A%84%E6%8A%95%E7%A0%94%E6%8E%A8%E7%90%86%E5%B9%B3%E5%8F%B0%2Fruntime&matchers=&preferredRegion=&middlewareConfig=e30%3D! ***!
  \********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (__WEBPACK_DEFAULT_EXPORT__),\n/* harmony export */   handler: () => (/* binding */ handler)\n/* harmony export */ });\n/* harmony import */ var next_dist_build_adapter_setup_node_env_external__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next/dist/build/adapter/setup-node-env.external */ \"next/dist/build/adapter/setup-node-env.external\");\n/* harmony import */ var next_dist_build_adapter_setup_node_env_external__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(next_dist_build_adapter_setup_node_env_external__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var next_dist_server_web_globals__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! next/dist/server/web/globals */ \"(middleware)/./node_modules/next/dist/server/web/globals.js\");\n/* harmony import */ var next_dist_server_web_globals__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_web_globals__WEBPACK_IMPORTED_MODULE_1__);\n/* harmony import */ var next_dist_server_web_adapter__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! next/dist/server/web/adapter */ \"(middleware)/./node_modules/next/dist/server/web/adapter.js\");\n/* harmony import */ var next_dist_server_web_adapter__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_web_adapter__WEBPACK_IMPORTED_MODULE_2__);\n/* harmony import */ var next_dist_server_lib_incremental_cache__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! next/dist/server/lib/incremental-cache */ \"(middleware)/./node_modules/next/dist/server/lib/incremental-cache/index.js\");\n/* harmony import */ var next_dist_server_lib_incremental_cache__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_lib_incremental_cache__WEBPACK_IMPORTED_MODULE_3__);\n/* harmony import */ var _proxy_ts__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./proxy.ts */ \"(middleware)/./proxy.ts\");\n/* harmony import */ var next_dist_client_components_is_next_router_error__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! next/dist/client/components/is-next-router-error */ \"(middleware)/./node_modules/next/dist/client/components/is-next-router-error.js\");\n/* harmony import */ var next_dist_client_components_is_next_router_error__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(next_dist_client_components_is_next_router_error__WEBPACK_IMPORTED_MODULE_5__);\n/* harmony import */ var next_dist_server_web_utils__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! next/dist/server/web/utils */ \"(middleware)/./node_modules/next/dist/server/web/utils.js\");\n/* harmony import */ var next_dist_server_web_utils__WEBPACK_IMPORTED_MODULE_6___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_web_utils__WEBPACK_IMPORTED_MODULE_6__);\n\n\n\n\nconst incrementalCacheHandler = null\n// Import the userland code.\n;\n\n\n\nconst mod = {\n    ..._proxy_ts__WEBPACK_IMPORTED_MODULE_4__\n};\nconst page = \"/proxy\";\nconst isProxy = page === '/proxy' || page === '/src/proxy';\nconst handlerUserland = (isProxy ? mod.proxy : mod.middleware) || mod.default;\nclass ProxyMissingExportError extends Error {\n    constructor(message){\n        super(message);\n        // Stack isn't useful here, remove it considering it spams logs during development.\n        this.stack = '';\n    }\n}\n// TODO: This spams logs during development. Find a better way to handle this.\n// Removing this will spam \"fn is not a function\" logs which is worse.\nif (typeof handlerUserland !== 'function') {\n    throw new ProxyMissingExportError(`The ${isProxy ? 'Proxy' : 'Middleware'} file \"${page}\" must export a function named \\`${isProxy ? 'proxy' : 'middleware'}\\` or a default function.`);\n}\n// Proxy will only sent out the FetchEvent to next server,\n// so load instrumentation module here and track the error inside proxy module.\nfunction errorHandledHandler(fn) {\n    return async (...args)=>{\n        try {\n            return await fn(...args);\n        } catch (err) {\n            // In development, error the navigation API usage in runtime,\n            // since it's not allowed to be used in proxy as it's outside of react component tree.\n            if (true) {\n                if ((0,next_dist_client_components_is_next_router_error__WEBPACK_IMPORTED_MODULE_5__.isNextRouterError)(err)) {\n                    err.message = `Next.js navigation API is not allowed to be used in ${isProxy ? 'Proxy' : 'Middleware'}.`;\n                    throw err;\n                }\n            }\n            const req = args[0];\n            const url = new URL(req.url);\n            const resource = url.pathname + url.search;\n            await (0,next_dist_server_web_globals__WEBPACK_IMPORTED_MODULE_1__.edgeInstrumentationOnRequestError)(err, {\n                path: resource,\n                method: req.method,\n                headers: Object.fromEntries(req.headers.entries())\n            }, {\n                routerKind: 'Pages Router',\n                routePath: '/proxy',\n                routeType: 'proxy',\n                revalidateReason: undefined\n            });\n            throw err;\n        }\n    };\n}\nconst internalHandler = (opts)=>{\n    return (0,next_dist_server_web_adapter__WEBPACK_IMPORTED_MODULE_2__.adapter)({\n        ...opts,\n        IncrementalCache: next_dist_server_lib_incremental_cache__WEBPACK_IMPORTED_MODULE_3__.IncrementalCache,\n        incrementalCacheHandler,\n        page,\n        handler: errorHandledHandler(handlerUserland)\n    });\n};\nasync function handler(request, ctx) {\n    const result = await internalHandler({\n        request: {\n            url: request.url,\n            method: request.method,\n            headers: (0,next_dist_server_web_utils__WEBPACK_IMPORTED_MODULE_6__.toNodeOutgoingHttpHeaders)(request.headers),\n            nextConfig: {\n                basePath: \"\",\n                i18n: \"\",\n                trailingSlash: Boolean(false),\n                experimental: {\n                    cacheLife: {\"default\":{\"stale\":300,\"revalidate\":900,\"expire\":4294967294},\"seconds\":{\"stale\":30,\"revalidate\":1,\"expire\":60},\"minutes\":{\"stale\":300,\"revalidate\":60,\"expire\":3600},\"hours\":{\"stale\":300,\"revalidate\":3600,\"expire\":86400},\"days\":{\"stale\":300,\"revalidate\":86400,\"expire\":604800},\"weeks\":{\"stale\":300,\"revalidate\":604800,\"expire\":2592000},\"max\":{\"stale\":300,\"revalidate\":2592000,\"expire\":31536000}},\n                    authInterrupts: Boolean(false),\n                    clientParamParsingOrigins: []\n                }\n            },\n            page: {\n                name: page\n            },\n            body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body ?? undefined : undefined,\n            waitUntil: ctx.waitUntil,\n            requestMeta: ctx.requestMeta,\n            signal: ctx.signal || new AbortController().signal\n        }\n    });\n    ctx.waitUntil == null ? void 0 : ctx.waitUntil.call(ctx, result.waitUntil);\n    return result.response;\n}\n// backwards compat\n/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (internalHandler);\n\n//# sourceMappingURL=middleware.js.map\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKG1pZGRsZXdhcmUpLy4vbm9kZV9tb2R1bGVzL25leHQvZGlzdC9idWlsZC93ZWJwYWNrL2xvYWRlcnMvbmV4dC1taWRkbGV3YXJlLWxvYWRlci5qcz9hYnNvbHV0ZVBhZ2VQYXRoPSUyRlVzZXJzJTJGbHV5YW8lMkZEb2N1bWVudHMlMkYlRTUlOUYlQkElRTQlQkElOEUlRTYlOUMlQUMlRTQlQkQlOTMlRTclOUElODQlRTYlOEElOTUlRTclQTAlOTQlRTYlOEUlQTglRTclOTAlODYlRTUlQjklQjMlRTUlOEYlQjAlMkZydW50aW1lJTJGcHJveHkudHMmcGFnZT0lMkZwcm94eSZyb290RGlyPSUyRlVzZXJzJTJGbHV5YW8lMkZEb2N1bWVudHMlMkYlRTUlOUYlQkElRTQlQkElOEUlRTYlOUMlQUMlRTQlQkQlOTMlRTclOUElODQlRTYlOEElOTUlRTclQTAlOTQlRTYlOEUlQTglRTclOTAlODYlRTUlQjklQjMlRTUlOEYlQjAlMkZydW50aW1lJm1hdGNoZXJzPSZwcmVmZXJyZWRSZWdpb249Jm1pZGRsZXdhcmVDb25maWc9ZTMwJTNEISIsIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBeUQ7QUFDbkI7QUFDaUI7QUFDbUI7QUFDMUU7QUFDQTtBQUNBLENBQW1DO0FBQzhDO0FBQ0k7QUFDZDtBQUN2RTtBQUNBLE9BQU8sc0NBQUk7QUFDWDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsNkNBQTZDLGtDQUFrQyxRQUFRLEtBQUssbUNBQW1DLGlDQUFpQztBQUNoSztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFVBQVU7QUFDVjtBQUNBO0FBQ0EsZ0JBQWdCLElBQXFDO0FBQ3JELG9CQUFvQixtR0FBaUI7QUFDckMseUZBQXlGLGlDQUFpQztBQUMxSDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxrQkFBa0IsK0ZBQWlDO0FBQ25EO0FBQ0E7QUFDQTtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ0E7QUFDQTtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsV0FBVyxxRUFBTztBQUNsQjtBQUNBLHdCQUF3QjtBQUN4QjtBQUNBO0FBQ0E7QUFDQSxLQUFLO0FBQ0w7QUFDTztBQUNQO0FBQ0E7QUFDQTtBQUNBO0FBQ0EscUJBQXFCLHFGQUF5QjtBQUM5QztBQUNBLDBCQUEwQixFQUE0QjtBQUN0RCxzQkFBc0IsRUFBOEI7QUFDcEQsdUNBQXVDLEtBQWlDO0FBQ3hFO0FBQ0EsK0JBQStCLDJZQUE2QjtBQUM1RCw0Q0FBNEMsS0FBK0M7QUFDM0YsK0NBQStDLEVBQStDO0FBQzlGO0FBQ0EsYUFBYTtBQUNiO0FBQ0E7QUFDQSxhQUFhO0FBQ2I7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0E7QUFDQTtBQUNBLGlFQUFlLGVBQWUsRUFBQzs7QUFFL0IiLCJzb3VyY2VzIjpbIiJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgXCJuZXh0L2Rpc3QvYnVpbGQvYWRhcHRlci9zZXR1cC1ub2RlLWVudi5leHRlcm5hbFwiO1xuaW1wb3J0IFwibmV4dC9kaXN0L3NlcnZlci93ZWIvZ2xvYmFsc1wiO1xuaW1wb3J0IHsgYWRhcHRlciB9IGZyb20gXCJuZXh0L2Rpc3Qvc2VydmVyL3dlYi9hZGFwdGVyXCI7XG5pbXBvcnQgeyBJbmNyZW1lbnRhbENhY2hlIH0gZnJvbSBcIm5leHQvZGlzdC9zZXJ2ZXIvbGliL2luY3JlbWVudGFsLWNhY2hlXCI7XG5jb25zdCBpbmNyZW1lbnRhbENhY2hlSGFuZGxlciA9IG51bGxcbi8vIEltcG9ydCB0aGUgdXNlcmxhbmQgY29kZS5cbmltcG9ydCAqIGFzIF9tb2QgZnJvbSBcIi4vcHJveHkudHNcIjtcbmltcG9ydCB7IGVkZ2VJbnN0cnVtZW50YXRpb25PblJlcXVlc3RFcnJvciB9IGZyb20gXCJuZXh0L2Rpc3Qvc2VydmVyL3dlYi9nbG9iYWxzXCI7XG5pbXBvcnQgeyBpc05leHRSb3V0ZXJFcnJvciB9IGZyb20gXCJuZXh0L2Rpc3QvY2xpZW50L2NvbXBvbmVudHMvaXMtbmV4dC1yb3V0ZXItZXJyb3JcIjtcbmltcG9ydCB7IHRvTm9kZU91dGdvaW5nSHR0cEhlYWRlcnMgfSBmcm9tIFwibmV4dC9kaXN0L3NlcnZlci93ZWIvdXRpbHNcIjtcbmNvbnN0IG1vZCA9IHtcbiAgICAuLi5fbW9kXG59O1xuY29uc3QgcGFnZSA9IFwiL3Byb3h5XCI7XG5jb25zdCBpc1Byb3h5ID0gcGFnZSA9PT0gJy9wcm94eScgfHwgcGFnZSA9PT0gJy9zcmMvcHJveHknO1xuY29uc3QgaGFuZGxlclVzZXJsYW5kID0gKGlzUHJveHkgPyBtb2QucHJveHkgOiBtb2QubWlkZGxld2FyZSkgfHwgbW9kLmRlZmF1bHQ7XG5jbGFzcyBQcm94eU1pc3NpbmdFeHBvcnRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICBjb25zdHJ1Y3RvcihtZXNzYWdlKXtcbiAgICAgICAgc3VwZXIobWVzc2FnZSk7XG4gICAgICAgIC8vIFN0YWNrIGlzbid0IHVzZWZ1bCBoZXJlLCByZW1vdmUgaXQgY29uc2lkZXJpbmcgaXQgc3BhbXMgbG9ncyBkdXJpbmcgZGV2ZWxvcG1lbnQuXG4gICAgICAgIHRoaXMuc3RhY2sgPSAnJztcbiAgICB9XG59XG4vLyBUT0RPOiBUaGlzIHNwYW1zIGxvZ3MgZHVyaW5nIGRldmVsb3BtZW50LiBGaW5kIGEgYmV0dGVyIHdheSB0byBoYW5kbGUgdGhpcy5cbi8vIFJlbW92aW5nIHRoaXMgd2lsbCBzcGFtIFwiZm4gaXMgbm90IGEgZnVuY3Rpb25cIiBsb2dzIHdoaWNoIGlzIHdvcnNlLlxuaWYgKHR5cGVvZiBoYW5kbGVyVXNlcmxhbmQgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgUHJveHlNaXNzaW5nRXhwb3J0RXJyb3IoYFRoZSAke2lzUHJveHkgPyAnUHJveHknIDogJ01pZGRsZXdhcmUnfSBmaWxlIFwiJHtwYWdlfVwiIG11c3QgZXhwb3J0IGEgZnVuY3Rpb24gbmFtZWQgXFxgJHtpc1Byb3h5ID8gJ3Byb3h5JyA6ICdtaWRkbGV3YXJlJ31cXGAgb3IgYSBkZWZhdWx0IGZ1bmN0aW9uLmApO1xufVxuLy8gUHJveHkgd2lsbCBvbmx5IHNlbnQgb3V0IHRoZSBGZXRjaEV2ZW50IHRvIG5leHQgc2VydmVyLFxuLy8gc28gbG9hZCBpbnN0cnVtZW50YXRpb24gbW9kdWxlIGhlcmUgYW5kIHRyYWNrIHRoZSBlcnJvciBpbnNpZGUgcHJveHkgbW9kdWxlLlxuZnVuY3Rpb24gZXJyb3JIYW5kbGVkSGFuZGxlcihmbikge1xuICAgIHJldHVybiBhc3luYyAoLi4uYXJncyk9PntcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBmbiguLi5hcmdzKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAvLyBJbiBkZXZlbG9wbWVudCwgZXJyb3IgdGhlIG5hdmlnYXRpb24gQVBJIHVzYWdlIGluIHJ1bnRpbWUsXG4gICAgICAgICAgICAvLyBzaW5jZSBpdCdzIG5vdCBhbGxvd2VkIHRvIGJlIHVzZWQgaW4gcHJveHkgYXMgaXQncyBvdXRzaWRlIG9mIHJlYWN0IGNvbXBvbmVudCB0cmVlLlxuICAgICAgICAgICAgaWYgKHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSAncHJvZHVjdGlvbicpIHtcbiAgICAgICAgICAgICAgICBpZiAoaXNOZXh0Um91dGVyRXJyb3IoZXJyKSkge1xuICAgICAgICAgICAgICAgICAgICBlcnIubWVzc2FnZSA9IGBOZXh0LmpzIG5hdmlnYXRpb24gQVBJIGlzIG5vdCBhbGxvd2VkIHRvIGJlIHVzZWQgaW4gJHtpc1Byb3h5ID8gJ1Byb3h5JyA6ICdNaWRkbGV3YXJlJ30uYDtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHJlcSA9IGFyZ3NbMF07XG4gICAgICAgICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcS51cmwpO1xuICAgICAgICAgICAgY29uc3QgcmVzb3VyY2UgPSB1cmwucGF0aG5hbWUgKyB1cmwuc2VhcmNoO1xuICAgICAgICAgICAgYXdhaXQgZWRnZUluc3RydW1lbnRhdGlvbk9uUmVxdWVzdEVycm9yKGVyciwge1xuICAgICAgICAgICAgICAgIHBhdGg6IHJlc291cmNlLFxuICAgICAgICAgICAgICAgIG1ldGhvZDogcmVxLm1ldGhvZCxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiBPYmplY3QuZnJvbUVudHJpZXMocmVxLmhlYWRlcnMuZW50cmllcygpKVxuICAgICAgICAgICAgfSwge1xuICAgICAgICAgICAgICAgIHJvdXRlcktpbmQ6ICdQYWdlcyBSb3V0ZXInLFxuICAgICAgICAgICAgICAgIHJvdXRlUGF0aDogJy9wcm94eScsXG4gICAgICAgICAgICAgICAgcm91dGVUeXBlOiAncHJveHknLFxuICAgICAgICAgICAgICAgIHJldmFsaWRhdGVSZWFzb246IHVuZGVmaW5lZFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICB9O1xufVxuY29uc3QgaW50ZXJuYWxIYW5kbGVyID0gKG9wdHMpPT57XG4gICAgcmV0dXJuIGFkYXB0ZXIoe1xuICAgICAgICAuLi5vcHRzLFxuICAgICAgICBJbmNyZW1lbnRhbENhY2hlLFxuICAgICAgICBpbmNyZW1lbnRhbENhY2hlSGFuZGxlcixcbiAgICAgICAgcGFnZSxcbiAgICAgICAgaGFuZGxlcjogZXJyb3JIYW5kbGVkSGFuZGxlcihoYW5kbGVyVXNlcmxhbmQpXG4gICAgfSk7XG59O1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZXIocmVxdWVzdCwgY3R4KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaW50ZXJuYWxIYW5kbGVyKHtcbiAgICAgICAgcmVxdWVzdDoge1xuICAgICAgICAgICAgdXJsOiByZXF1ZXN0LnVybCxcbiAgICAgICAgICAgIG1ldGhvZDogcmVxdWVzdC5tZXRob2QsXG4gICAgICAgICAgICBoZWFkZXJzOiB0b05vZGVPdXRnb2luZ0h0dHBIZWFkZXJzKHJlcXVlc3QuaGVhZGVycyksXG4gICAgICAgICAgICBuZXh0Q29uZmlnOiB7XG4gICAgICAgICAgICAgICAgYmFzZVBhdGg6IHByb2Nlc3MuZW52Ll9fTkVYVF9CQVNFX1BBVEgsXG4gICAgICAgICAgICAgICAgaTE4bjogcHJvY2Vzcy5lbnYuX19ORVhUX0kxOE5fQ09ORklHLFxuICAgICAgICAgICAgICAgIHRyYWlsaW5nU2xhc2g6IEJvb2xlYW4ocHJvY2Vzcy5lbnYuX19ORVhUX1RSQUlMSU5HX1NMQVNIKSxcbiAgICAgICAgICAgICAgICBleHBlcmltZW50YWw6IHtcbiAgICAgICAgICAgICAgICAgICAgY2FjaGVMaWZlOiBwcm9jZXNzLmVudi5fX05FWFRfQ0FDSEVfTElGRSxcbiAgICAgICAgICAgICAgICAgICAgYXV0aEludGVycnVwdHM6IEJvb2xlYW4ocHJvY2Vzcy5lbnYuX19ORVhUX0VYUEVSSU1FTlRBTF9BVVRIX0lOVEVSUlVQVFMpLFxuICAgICAgICAgICAgICAgICAgICBjbGllbnRQYXJhbVBhcnNpbmdPcmlnaW5zOiBwcm9jZXNzLmVudi5fX05FWFRfQ0xJRU5UX1BBUkFNX1BBUlNJTkdfT1JJR0lOU1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwYWdlOiB7XG4gICAgICAgICAgICAgICAgbmFtZTogcGFnZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGJvZHk6IHJlcXVlc3QubWV0aG9kICE9PSAnR0VUJyAmJiByZXF1ZXN0Lm1ldGhvZCAhPT0gJ0hFQUQnID8gcmVxdWVzdC5ib2R5ID8/IHVuZGVmaW5lZCA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIHdhaXRVbnRpbDogY3R4LndhaXRVbnRpbCxcbiAgICAgICAgICAgIHJlcXVlc3RNZXRhOiBjdHgucmVxdWVzdE1ldGEsXG4gICAgICAgICAgICBzaWduYWw6IGN0eC5zaWduYWwgfHwgbmV3IEFib3J0Q29udHJvbGxlcigpLnNpZ25hbFxuICAgICAgICB9XG4gICAgfSk7XG4gICAgY3R4LndhaXRVbnRpbCA9PSBudWxsID8gdm9pZCAwIDogY3R4LndhaXRVbnRpbC5jYWxsKGN0eCwgcmVzdWx0LndhaXRVbnRpbCk7XG4gICAgcmV0dXJuIHJlc3VsdC5yZXNwb25zZTtcbn1cbi8vIGJhY2t3YXJkcyBjb21wYXRcbmV4cG9ydCBkZWZhdWx0IGludGVybmFsSGFuZGxlcjtcblxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9bWlkZGxld2FyZS5qcy5tYXBcbiJdLCJuYW1lcyI6W10sImlnbm9yZUxpc3QiOltdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(middleware)/./node_modules/next/dist/build/webpack/loaders/next-middleware-loader.js?absolutePagePath=%2FUsers%2Fluyao%2FDocuments%2F%E5%9F%BA%E4%BA%8E%E6%9C%AC%E4%BD%93%E7%9A%84%E6%8A%95%E7%A0%94%E6%8E%A8%E7%90%86%E5%B9%B3%E5%8F%B0%2Fruntime%2Fproxy.ts&page=%2Fproxy&rootDir=%2FUsers%2Fluyao%2FDocuments%2F%E5%9F%BA%E4%BA%8E%E6%9C%AC%E4%BD%93%E7%9A%84%E6%8A%95%E7%A0%94%E6%8E%A8%E7%90%86%E5%B9%B3%E5%8F%B0%2Fruntime&matchers=&preferredRegion=&middlewareConfig=e30%3D!\n");

/***/ }),

/***/ "(middleware)/./proxy.ts":
/*!******************!*\
  !*** ./proxy.ts ***!
  \******************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   config: () => (/* binding */ config),\n/* harmony export */   proxy: () => (/* binding */ proxy)\n/* harmony export */ });\n/* harmony import */ var next_server__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next/server */ \"(middleware)/./node_modules/next/dist/api/server.js\");\n\nconst MUTATING_METHODS = new Set([\n    \"POST\",\n    \"PUT\",\n    \"PATCH\",\n    \"DELETE\"\n]);\nfunction isLoopbackHost(rawHost) {\n    const host = rawHost.trim().toLowerCase();\n    return /^(?:localhost|127(?:\\.\\d{1,3}){3}|\\[::1\\])(?::\\d{1,5})?$/.test(host);\n}\nfunction proxy(request) {\n    const host = request.headers.get(\"host\") || \"\";\n    if (!isLoopbackHost(host)) return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n        error: \"Runtime API 只接受本机回环 Host\"\n    }, {\n        status: 403\n    });\n    if (MUTATING_METHODS.has(request.method.toUpperCase())) {\n        const fetchSite = (request.headers.get(\"sec-fetch-site\") || \"\").toLowerCase();\n        if (fetchSite === \"cross-site\") return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            error: \"拒绝跨站写入本机 Runtime API\"\n        }, {\n            status: 403\n        });\n        const origin = request.headers.get(\"origin\");\n        if (origin) {\n            let originHost = \"\";\n            try {\n                originHost = new URL(origin).host.toLowerCase();\n            } catch  {\n                return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n                    error: \"Origin 非法\"\n                }, {\n                    status: 403\n                });\n            }\n            if (originHost !== host.toLowerCase()) return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n                error: \"Origin 与 Runtime Host 不一致\"\n            }, {\n                status: 403\n            });\n        }\n    }\n    const response = next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.next();\n    response.headers.set(\"cache-control\", \"no-store\");\n    response.headers.set(\"x-content-type-options\", \"nosniff\");\n    response.headers.set(\"referrer-policy\", \"no-referrer\");\n    return response;\n}\nconst config = {\n    matcher: \"/api/:path*\"\n};\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKG1pZGRsZXdhcmUpLy4vcHJveHkudHMiLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQXdEO0FBRXhELE1BQU1DLG1CQUFtQixJQUFJQyxJQUFJO0lBQUM7SUFBUTtJQUFPO0lBQVM7Q0FBUztBQUVuRSxTQUFTQyxlQUFlQyxPQUFlO0lBQ3JDLE1BQU1DLE9BQU9ELFFBQVFFLElBQUksR0FBR0MsV0FBVztJQUN2QyxPQUFPLDJEQUEyREMsSUFBSSxDQUFDSDtBQUN6RTtBQUVPLFNBQVNJLE1BQU1DLE9BQW9CO0lBQ3hDLE1BQU1MLE9BQU9LLFFBQVFDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLFdBQVc7SUFDNUMsSUFBSSxDQUFDVCxlQUFlRSxPQUFPLE9BQU9MLHFEQUFZQSxDQUFDYSxJQUFJLENBQUM7UUFBRUMsT0FBTztJQUEyQixHQUFHO1FBQUVDLFFBQVE7SUFBSTtJQUV6RyxJQUFJZCxpQkFBaUJlLEdBQUcsQ0FBQ04sUUFBUU8sTUFBTSxDQUFDQyxXQUFXLEtBQUs7UUFDdEQsTUFBTUMsWUFBWSxDQUFDVCxRQUFRQyxPQUFPLENBQUNDLEdBQUcsQ0FBQyxxQkFBcUIsRUFBQyxFQUFHTCxXQUFXO1FBQzNFLElBQUlZLGNBQWMsY0FBYyxPQUFPbkIscURBQVlBLENBQUNhLElBQUksQ0FBQztZQUFFQyxPQUFPO1FBQXVCLEdBQUc7WUFBRUMsUUFBUTtRQUFJO1FBQzFHLE1BQU1LLFNBQVNWLFFBQVFDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDO1FBQ25DLElBQUlRLFFBQVE7WUFDVixJQUFJQyxhQUFhO1lBQ2pCLElBQUk7Z0JBQUVBLGFBQWEsSUFBSUMsSUFBSUYsUUFBUWYsSUFBSSxDQUFDRSxXQUFXO1lBQUksRUFBRSxPQUFNO2dCQUFFLE9BQU9QLHFEQUFZQSxDQUFDYSxJQUFJLENBQUM7b0JBQUVDLE9BQU87Z0JBQVksR0FBRztvQkFBRUMsUUFBUTtnQkFBSTtZQUFJO1lBQ3BJLElBQUlNLGVBQWVoQixLQUFLRSxXQUFXLElBQUksT0FBT1AscURBQVlBLENBQUNhLElBQUksQ0FBQztnQkFBRUMsT0FBTztZQUE0QixHQUFHO2dCQUFFQyxRQUFRO1lBQUk7UUFDeEg7SUFDRjtJQUVBLE1BQU1RLFdBQVd2QixxREFBWUEsQ0FBQ3dCLElBQUk7SUFDbENELFNBQVNaLE9BQU8sQ0FBQ2MsR0FBRyxDQUFDLGlCQUFpQjtJQUN0Q0YsU0FBU1osT0FBTyxDQUFDYyxHQUFHLENBQUMsMEJBQTBCO0lBQy9DRixTQUFTWixPQUFPLENBQUNjLEdBQUcsQ0FBQyxtQkFBbUI7SUFDeEMsT0FBT0Y7QUFDVDtBQUVPLE1BQU1HLFNBQVM7SUFBRUMsU0FBUztBQUFjLEVBQUUiLCJzb3VyY2VzIjpbIi9Vc2Vycy9sdXlhby9Eb2N1bWVudHMv5Z+65LqO5pys5L2T55qE5oqV56CU5o6o55CG5bmz5Y+wL3J1bnRpbWUvcHJveHkudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTmV4dFJlcXVlc3QsIE5leHRSZXNwb25zZSB9IGZyb20gXCJuZXh0L3NlcnZlclwiO1xuXG5jb25zdCBNVVRBVElOR19NRVRIT0RTID0gbmV3IFNldChbXCJQT1NUXCIsIFwiUFVUXCIsIFwiUEFUQ0hcIiwgXCJERUxFVEVcIl0pO1xuXG5mdW5jdGlvbiBpc0xvb3BiYWNrSG9zdChyYXdIb3N0OiBzdHJpbmcpIHtcbiAgY29uc3QgaG9zdCA9IHJhd0hvc3QudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiAvXig/OmxvY2FsaG9zdHwxMjcoPzpcXC5cXGR7MSwzfSl7M318XFxbOjoxXFxdKSg/OjpcXGR7MSw1fSk/JC8udGVzdChob3N0KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHByb3h5KHJlcXVlc3Q6IE5leHRSZXF1ZXN0KSB7XG4gIGNvbnN0IGhvc3QgPSByZXF1ZXN0LmhlYWRlcnMuZ2V0KFwiaG9zdFwiKSB8fCBcIlwiO1xuICBpZiAoIWlzTG9vcGJhY2tIb3N0KGhvc3QpKSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogXCJSdW50aW1lIEFQSSDlj6rmjqXlj5fmnKzmnLrlm57njq8gSG9zdFwiIH0sIHsgc3RhdHVzOiA0MDMgfSk7XG5cbiAgaWYgKE1VVEFUSU5HX01FVEhPRFMuaGFzKHJlcXVlc3QubWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG4gICAgY29uc3QgZmV0Y2hTaXRlID0gKHJlcXVlc3QuaGVhZGVycy5nZXQoXCJzZWMtZmV0Y2gtc2l0ZVwiKSB8fCBcIlwiKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChmZXRjaFNpdGUgPT09IFwiY3Jvc3Mtc2l0ZVwiKSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogXCLmi5Lnu53ot6jnq5nlhpnlhaXmnKzmnLogUnVudGltZSBBUElcIiB9LCB7IHN0YXR1czogNDAzIH0pO1xuICAgIGNvbnN0IG9yaWdpbiA9IHJlcXVlc3QuaGVhZGVycy5nZXQoXCJvcmlnaW5cIik7XG4gICAgaWYgKG9yaWdpbikge1xuICAgICAgbGV0IG9yaWdpbkhvc3QgPSBcIlwiO1xuICAgICAgdHJ5IHsgb3JpZ2luSG9zdCA9IG5ldyBVUkwob3JpZ2luKS5ob3N0LnRvTG93ZXJDYXNlKCk7IH0gY2F0Y2ggeyByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogXCJPcmlnaW4g6Z2e5rOVXCIgfSwgeyBzdGF0dXM6IDQwMyB9KTsgfVxuICAgICAgaWYgKG9yaWdpbkhvc3QgIT09IGhvc3QudG9Mb3dlckNhc2UoKSkgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6IFwiT3JpZ2luIOS4jiBSdW50aW1lIEhvc3Qg5LiN5LiA6Ie0XCIgfSwgeyBzdGF0dXM6IDQwMyB9KTtcbiAgICB9XG4gIH1cblxuICBjb25zdCByZXNwb25zZSA9IE5leHRSZXNwb25zZS5uZXh0KCk7XG4gIHJlc3BvbnNlLmhlYWRlcnMuc2V0KFwiY2FjaGUtY29udHJvbFwiLCBcIm5vLXN0b3JlXCIpO1xuICByZXNwb25zZS5oZWFkZXJzLnNldChcIngtY29udGVudC10eXBlLW9wdGlvbnNcIiwgXCJub3NuaWZmXCIpO1xuICByZXNwb25zZS5oZWFkZXJzLnNldChcInJlZmVycmVyLXBvbGljeVwiLCBcIm5vLXJlZmVycmVyXCIpO1xuICByZXR1cm4gcmVzcG9uc2U7XG59XG5cbmV4cG9ydCBjb25zdCBjb25maWcgPSB7IG1hdGNoZXI6IFwiL2FwaS86cGF0aCpcIiB9O1xuIl0sIm5hbWVzIjpbIk5leHRSZXNwb25zZSIsIk1VVEFUSU5HX01FVEhPRFMiLCJTZXQiLCJpc0xvb3BiYWNrSG9zdCIsInJhd0hvc3QiLCJob3N0IiwidHJpbSIsInRvTG93ZXJDYXNlIiwidGVzdCIsInByb3h5IiwicmVxdWVzdCIsImhlYWRlcnMiLCJnZXQiLCJqc29uIiwiZXJyb3IiLCJzdGF0dXMiLCJoYXMiLCJtZXRob2QiLCJ0b1VwcGVyQ2FzZSIsImZldGNoU2l0ZSIsIm9yaWdpbiIsIm9yaWdpbkhvc3QiLCJVUkwiLCJyZXNwb25zZSIsIm5leHQiLCJzZXQiLCJjb25maWciLCJtYXRjaGVyIl0sImlnbm9yZUxpc3QiOltdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(middleware)/./proxy.ts\n");

/***/ }),

/***/ "../app-render/after-task-async-storage.external":
/*!***********************************************************************************!*\
  !*** external "next/dist/server/app-render/after-task-async-storage.external.js" ***!
  \***********************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/server/app-render/after-task-async-storage.external.js");

/***/ }),

/***/ "../app-render/work-async-storage.external":
/*!*****************************************************************************!*\
  !*** external "next/dist/server/app-render/work-async-storage.external.js" ***!
  \*****************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/server/app-render/work-async-storage.external.js");

/***/ }),

/***/ "./memory-cache.external":
/*!**********************************************************************************!*\
  !*** external "next/dist/server/lib/incremental-cache/memory-cache.external.js" ***!
  \**********************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/server/lib/incremental-cache/memory-cache.external.js");

/***/ }),

/***/ "./shared-cache-controls.external":
/*!*******************************************************************************************!*\
  !*** external "next/dist/server/lib/incremental-cache/shared-cache-controls.external.js" ***!
  \*******************************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/server/lib/incremental-cache/shared-cache-controls.external.js");

/***/ }),

/***/ "./tags-manifest.external":
/*!***********************************************************************************!*\
  !*** external "next/dist/server/lib/incremental-cache/tags-manifest.external.js" ***!
  \***********************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/server/lib/incremental-cache/tags-manifest.external.js");

/***/ }),

/***/ "./work-unit-async-storage.external":
/*!**********************************************************************************!*\
  !*** external "next/dist/server/app-render/work-unit-async-storage.external.js" ***!
  \**********************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/server/app-render/work-unit-async-storage.external.js");

/***/ }),

/***/ "crypto":
/*!*************************!*\
  !*** external "crypto" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("crypto");

/***/ }),

/***/ "next/dist/build/adapter/setup-node-env.external":
/*!******************************************************************!*\
  !*** external "next/dist/build/adapter/setup-node-env.external" ***!
  \******************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/build/adapter/setup-node-env.external");

/***/ }),

/***/ "next/dist/compiled/next-server/app-page.runtime.dev.js":
/*!*************************************************************************!*\
  !*** external "next/dist/compiled/next-server/app-page.runtime.dev.js" ***!
  \*************************************************************************/
/***/ ((module) => {

module.exports = require("next/dist/compiled/next-server/app-page.runtime.dev.js");

/***/ }),

/***/ "node:async_hooks":
/*!***********************************!*\
  !*** external "node:async_hooks" ***!
  \***********************************/
/***/ ((module) => {

module.exports = require("node:async_hooks");

/***/ }),

/***/ "path":
/*!***********************!*\
  !*** external "path" ***!
  \***********************/
/***/ ((module) => {

module.exports = require("path");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("./webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = __webpack_require__.X(0, ["vendor-chunks/next","vendor-chunks/@swc"], () => (__webpack_exec__("(middleware)/./node_modules/next/dist/build/webpack/loaders/next-middleware-loader.js?absolutePagePath=%2FUsers%2Fluyao%2FDocuments%2F%E5%9F%BA%E4%BA%8E%E6%9C%AC%E4%BD%93%E7%9A%84%E6%8A%95%E7%A0%94%E6%8E%A8%E7%90%86%E5%B9%B3%E5%8F%B0%2Fruntime%2Fproxy.ts&page=%2Fproxy&rootDir=%2FUsers%2Fluyao%2FDocuments%2F%E5%9F%BA%E4%BA%8E%E6%9C%AC%E4%BD%93%E7%9A%84%E6%8A%95%E7%A0%94%E6%8E%A8%E7%90%86%E5%B9%B3%E5%8F%B0%2Fruntime&matchers=&preferredRegion=&middlewareConfig=e30%3D!")));
module.exports = __webpack_exports__;

})();