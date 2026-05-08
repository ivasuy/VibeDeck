const { checkAndActivate } = require("../lib/activation-check");

/**
 * 检测并激活未配置的 AI CLI 集成
 * 用于 hooks 或其他触发器调用
 */
async function cmdActivateIfNeeded(argv) {
  const opts = parseArgs(argv);
  
  const results = await checkAndActivate({
    silent: opts.silent,
    autoConfigure: true,
  });
  
  if (!opts.silent) {
    if (results.length === 0) {
      console.log("所有 AI CLI 集成已配置完成");
    } else {
      for (const r of results) {
        const icon = r.action === "configured" ? "✅" : "❌";
        console.log(`${icon} ${r.displayName}: ${r.action}`);
      }
    }
  }
  
  // 如果有任何配置成功，返回 0，否则返回 1
  const hasSuccess = results.some(r => r.action === "configured");
  process.exitCode = hasSuccess ? 0 : 0; // 始终返回 0，不阻塞调用方
}

function parseArgs(argv) {
  const out = {
    silent: false,
  };
  for (const a of argv) {
    if (a === "--silent") out.silent = true;
  }
  return out;
}

module.exports = { cmdActivateIfNeeded };