import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scriptsDir = __dirname;
const allFiles = fs.readdirSync(scriptsDir)
  .filter(f => f.startsWith('test-') && f.endsWith('.ts'))
  .sort();

console.log(`Found ${allFiles.length} test scripts to execute.\n`);

const results = [];

function runScript(file) {
  return new Promise((resolve) => {
    const fullPath = path.join(scriptsDir, file);
    const cmd = `npx tsx scripts/${file}`;
    const start = Date.now();
    exec(cmd, { cwd: path.resolve(__dirname, '..'), timeout: 60000 }, (error, stdout, stderr) => {
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      const passed = !error;
      const passMatches = stdout.match(/✔ PASS/g) || [];
      const failMatches = stdout.match(/✖ FAIL/g) || [];
      
      resolve({
        file,
        passed,
        exitCode: error ? error.code : 0,
        duration,
        passCount: passMatches.length,
        failCount: failMatches.length,
        error: error ? (stderr || stdout).slice(-300).trim() : null
      });
    });
  });
}

async function main() {
  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i];
    process.stdout.write(`[${i + 1}/${allFiles.length}] Running ${file}... `);
    const res = await runScript(file);
    if (res.passed) {
      console.log(`✔ OK (${res.duration}s, ${res.passCount} assertions)`);
    } else {
      console.log(`✖ FAIL (exit ${res.exitCode}, ${res.failCount} fails, ${res.duration}s)`);
      if (res.error) {
        console.log(`   Error: ${res.error.replace(/\n/g, ' ')}`);
      }
    }
    results.push(res);
  }

  const passedTests = results.filter(r => r.passed);
  const failedTests = results.filter(r => !r.passed);

  console.log('\n============================================================');
  console.log(`AUDIT RESULTS: ${passedTests.length} PASSED / ${failedTests.length} FAILED (Total: ${allFiles.length})`);
  console.log('============================================================');
  if (failedTests.length > 0) {
    console.log('\nFAILED SCRIPTS:');
    failedTests.forEach(f => console.log(` - ${f.file}: ${f.error}`));
  }
}

main().catch(console.error);
