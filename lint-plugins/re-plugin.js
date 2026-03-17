import { eslintCompatPlugin } from "@oxlint/plugins";

// --- Rule: no-noop-catch ---
// Flags `.catch(() => undefined)`, `.catch(() => {})`, `.catch(() => void 0)`,
// and `.catch((_) => undefined)` etc. — any `.catch` where the callback body
// is effectively empty / returns a trivial value without using the error.
//
// These silently swallow Promise rejections, causing IPC failures to vanish
// with no user feedback, stale state, or debugging information.
//
// To intentionally swallow an error, use a descriptive helper or add a comment:
//   .catch(() => undefined) // oxlint-disable-next-line re/no-noop-catch -- reason
//   .catch(swallowRejection("reason"))

const noNoopCatch = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow .catch() callbacks that silently discard errors without logging or handling them",
    },
    messages: {
      noNoopCatch:
        "Empty .catch() silently swallows errors. Add error handling (logging, state update, or user feedback). " +
        "If intentional, disable with a comment explaining why: // oxlint-disable-line re/no-noop-catch -- <reason>",
    },
  },

  createOnce(context) {
    return {
      // Match .catch(callback) call expressions
      CallExpression(node) {
        // Must be a .catch() member call
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.property.type !== "Identifier" ||
          node.callee.property.name !== "catch"
        ) {
          return;
        }

        // Must have exactly 1 argument
        if (node.arguments.length !== 1) return;

        const callback = node.arguments[0];

        // Must be an arrow function or function expression
        if (
          callback.type !== "ArrowFunctionExpression" &&
          callback.type !== "FunctionExpression"
        ) {
          return;
        }

        // Check if the callback body is a "noop":
        // 1. Arrow with expression body: () => undefined, () => void 0, () => void expr
        // 2. Arrow/function with block body containing 0 statements: () => {}
        if (isNoopCallback(callback)) {
          context.report({
            node: callback,
            messageId: "noNoopCatch",
          });
        }
      },
    };
  },
};

/**
 * Checks if a callback is a "noop" — i.e., its body does nothing meaningful.
 *
 * Detects:
 * - `() => undefined`
 * - `() => void 0` / `() => void anything`
 * - `() => {}`  (empty block)
 * - `(_e) => undefined` (error param unused)
 */
function isNoopCallback(callback) {
  const body = callback.body;

  if (callback.expression) {
    // Arrow function with expression body: () => <expr>
    return isNoopExpression(body);
  }

  // Block body: check for empty block
  if (body.type === "BlockStatement" && body.body.length === 0) {
    return true;
  }

  return false;
}

/**
 * Checks if an expression is a "noop" return value:
 * - `undefined` literal identifier
 * - `void 0` or `void <expr>` unary expression
 */
function isNoopExpression(expr) {
  // undefined
  if (expr.type === "Identifier" && expr.name === "undefined") {
    return true;
  }

  // void 0, void anything
  if (expr.type === "UnaryExpression" && expr.operator === "void") {
    return true;
  }

  return false;
}

// --- Rule: no-rpc-defect-catch ---
// Flags direct `Effect.catchTag("RpcDefectError", ...)` calls.
//
// This 2-line block is repeated 55 times across 26 files, always identical:
//   Effect.catchTag("RpcDefectError", (rpcDefect) =>
//     Effect.fail(toRpcDefectError(rpcDefect)))
//
// It should be centralized (e.g. inside `runIpcEffect`) rather than
// copy-pasted at every IPC call site.

const noRpcDefectCatch = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        'Disallow direct Effect.catchTag("RpcDefectError", ...) — centralize RpcDefectError handling in runIpcEffect',
    },
    messages: {
      noRpcDefectCatch:
        'Do not catch RpcDefectError at call sites. Centralize RpcDefectError handling in runIpcEffect (ipc-query.ts) instead.',
    },
  },

  createOnce(context) {
    return {
      CallExpression(node) {
        // Match Effect.catchTag("RpcDefectError", ...)
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.property.type !== "Identifier" ||
          node.callee.property.name !== "catchTag"
        ) {
          return;
        }

        // First argument must be the string "RpcDefectError"
        if (
          node.arguments.length < 1 ||
          node.arguments[0].type !== "Literal" ||
          node.arguments[0].value !== "RpcDefectError"
        ) {
          return;
        }

        // Allow usage inside ipc-query.ts (the centralized handler)
        const filename = context.filename || context.getFilename();
        if (filename.includes("ipc-query")) {
          return;
        }

        context.report({
          node,
          messageId: "noRpcDefectCatch",
        });
      },
    };
  },
};

// --- Plugin export ---

const plugin = eslintCompatPlugin({
  meta: {
    name: "re",
  },
  rules: {
    "no-noop-catch": noNoopCatch,
    "no-rpc-defect-catch": noRpcDefectCatch,
  },
});

export default plugin;
