const { execSync } = require('child_process');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePid(rawOutput) {
  if (!rawOutput) return null;

  const firstLine = rawOutput
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine || null;
}

function getCommandPreview(pid) {
  const command = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' }).toString().trim();
  if (!command) return 'unknown';
  return command.length > 120 ? `${command.slice(0, 117)}...` : command;
}

function isPortInUse(port) {
  const pid = parsePid(execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).toString().trim());
  return pid ? pid : null;
}

async function promptForKill(port, pid, commandPreview) {
  process.stdout.write(`⚠️ Port ${port} in use by PID ${pid} (${commandPreview})\n`);
  process.stdout.write('Kill it and continue? (y/N) ');

  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', (data) => {
      process.stdin.pause();
      const answer = String(data || '').trim().toLowerCase();
      resolve(answer === 'y');
    });
    process.stdin.once('error', () => resolve(false));
  });
}

async function checkAndKillStaleProcess(port = 3405) {
  let pid;

  try {
    pid = isPortInUse(port);
  } catch {
    return true;
  }

  if (!pid) {
    return true;
  }

  let commandPreview = 'unknown';
  try {
    commandPreview = getCommandPreview(pid);
  } catch {
    // Keep fallback command preview
  }

  const shouldKill = await promptForKill(port, pid, commandPreview);
  if (!shouldKill) {
    console.error(`❌ Aborted: Port ${port} is in use.`);
    return false;
  }

  try {
    execSync(`kill -9 ${pid}`);
  } catch (err) {
    console.error(`❌ Failed to kill PID ${pid}: ${err.message}`);
    return false;
  }

  await sleep(1000);

  let secondCheck;
  try {
    secondCheck = isPortInUse(port);
  } catch {
    return true;
  }

  if (secondCheck) {
    console.error(`❌ Port ${port} is still in use after kill.`);
    return false;
  }

  return true;
}

module.exports = {
  checkAndKillStaleProcess,
};
