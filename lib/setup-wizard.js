/**
 * First-Run Setup Wizard
 * Guides users through initial Evobrew configuration
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setupWizard(projectRoot) {
  console.log('\n════════════════════════════════════════════════');
  console.log('🚀 Evobrew First-Time Setup');
  console.log('════════════════════════════════════════════════\n');

  const envPath = path.join(projectRoot, '.env');
  const envExamplePath = path.join(projectRoot, '.env.example');
  const dbPath = path.join(projectRoot, 'prisma', 'studio.db');

  // Step 1: Create .env if missing
  if (!fs.existsSync(envPath)) {
    console.log('📝 No configuration found. Creating .env file...\n');
    
    if (fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
      console.log('✅ Created .env from template\n');
    } else {
      console.log('❌ Error: .env.example not found');
      process.exit(1);
    }
  }

  // Step 2: Generate encryption key if needed
  const envContent = fs.readFileSync(envPath, 'utf8');
  const hasValidKey = envContent.match(/ENCRYPTION_KEY=[a-f0-9]{64}/);
  
  if (!hasValidKey) {
    
    console.log('🔐 Generating encryption key...');
    try {
      const { stdout } = await execAsync('openssl rand -hex 32');
      const encryptionKey = stdout.trim();
      
      const updatedEnv = envContent.replace(
        /ENCRYPTION_KEY=.*/,
        `ENCRYPTION_KEY=${encryptionKey}`
      );
      fs.writeFileSync(envPath, updatedEnv);
      console.log('✅ Encryption key generated\n');
    } catch (err) {
      console.log('⚠️  Could not auto-generate encryption key');
      console.log('   Please run: openssl rand -hex 32');
      console.log('   And add to .env as ENCRYPTION_KEY\n');
    }
  }

  // Step 3: Check for API keys (detect actual keys, not placeholders)
  console.log('🔑 API Key Configuration');
  console.log('─────────────────────────────────────────────\n');
  
  const hasOpenAI = envContent.match(/OPENAI_API_KEY=sk-proj-[^\s]+/) && 
                    !envContent.includes('your_openai_key_here');
  const hasAnthropic = envContent.match(/ANTHROPIC_API_KEY=sk-ant-[^\s]+/) && 
                       !envContent.includes('your_anthropic_key_here');
  const hasXAI = envContent.match(/XAI_API_KEY=xai-[^\s]+/) && 
                 !envContent.includes('your_xai_key_here');
  
  if (!hasOpenAI && !hasAnthropic && !hasXAI) {
    console.log('⚠️  No API keys found in .env');
    console.log('\nYou need at least ONE of:\n');
    console.log('  • OpenAI API key     (https://platform.openai.com/api-keys)');
    console.log('  • Anthropic API key  (https://console.anthropic.com/settings/keys)');
    console.log('  • xAI API key        (https://console.x.ai/)\n');
    
    const proceed = await question('Open .env file now to add keys? (y/n): ');
    if (proceed.toLowerCase() === 'y') {
      console.log(`\n📝 Opening ${envPath}...\n`);
      console.log('Add your API keys, save, and run: npx evobrew start\n');
      
      // Try to open with default editor
      if (process.platform === 'darwin') {
        exec(`open -e "${envPath}"`);
      } else if (process.platform === 'linux') {
        exec(`xdg-open "${envPath}"`);
      } else {
        console.log(`Manually open: ${envPath}`);
      }
      
      rl.close();
      process.exit(0);
    }
  } else {
    console.log('✅ API keys configured:');
    if (hasOpenAI) console.log('   • OpenAI');
    if (hasAnthropic) console.log('   • Anthropic');
    if (hasXAI) console.log('   • xAI (Grok)');
    console.log('');
  }

  // Step 4: Database initialization
  if (!fs.existsSync(dbPath)) {
    console.log('🗄️  Database not initialized\n');
    const initDB = await question('Initialize database now? (y/n): ');
    
    if (initDB.toLowerCase() === 'y') {
      console.log('\n⏳ Running migrations...\n');
      try {
        await execAsync('npm run db:migrate', { cwd: projectRoot });
        console.log('✅ Database initialized\n');
      } catch (err) {
        console.log('❌ Migration failed:', err.message);
        console.log('   Try manually: npm run db:migrate\n');
      }
    }
  }

  // Step 5: Anthropic OAuth check
  const envContentFresh = fs.readFileSync(envPath, 'utf8');
  const oauthOnly = envContentFresh.match(/ANTHROPIC_OAUTH_ONLY=true/);
  const hasAnthropicKey = envContentFresh.match(/ANTHROPIC_API_KEY=sk-ant-[^\s]+/) && 
                          !envContentFresh.includes('your_anthropic_key_here');
  
  if (oauthOnly && !hasAnthropicKey) {
    console.log('\n⚠️  Warning: ANTHROPIC_OAUTH_ONLY=true but no API key found');
    console.log('    You need to set up OAuth to use Anthropic models.\n');
    
    const setupOAuth = await question('Set up Anthropic OAuth now? (y/n): ');
    
    if (setupOAuth.toLowerCase() === 'y') {
      console.log('\n⏳ Launching OAuth setup...\n');
      rl.close();
      
      try {
        const { spawn } = require('child_process');
        const oauth = spawn('node', ['import-oauth.js'], {
          stdio: 'inherit',
          cwd: projectRoot
        });
        
        oauth.on('close', (code) => {
          if (code === 0) {
            console.log('\n✅ OAuth setup complete!\n');
            console.log('Run: npx evobrew start\n');
          } else {
            console.log('\n⚠️  OAuth setup cancelled or failed');
            console.log('   You can run it later: node import-oauth.js');
            console.log('   Or use API keys: set ANTHROPIC_OAUTH_ONLY=false in .env\n');
          }
          process.exit(code);
        });
        
        return;
      } catch (err) {
        console.log('❌ Could not launch OAuth setup:', err.message);
        console.log('   Try manually: node import-oauth.js\n');
      }
    } else {
      console.log('\n💡 To use Anthropic without OAuth:');
      console.log('   1. Add ANTHROPIC_API_KEY=sk-ant-... to .env');
      console.log('   2. Set ANTHROPIC_OAUTH_ONLY=false in .env\n');
    }
  } else if (oauthOnly && hasAnthropicKey) {
    console.log('🔐 Anthropic OAuth Configuration');
    console.log('─────────────────────────────────────────────\n');
    console.log('Your .env has ANTHROPIC_OAUTH_ONLY=true');
    console.log('This requires OAuth token setup for Anthropic models.\n');
    
    const setupOAuth = await question('Set up Anthropic OAuth now? (y/n): ');
    
    if (setupOAuth.toLowerCase() === 'y') {
      console.log('\n⏳ Launching OAuth setup...\n');
      rl.close();
      
      try {
        const { spawn } = require('child_process');
        const oauth = spawn('node', ['import-oauth.js'], {
          stdio: 'inherit',
          cwd: projectRoot
        });
        
        oauth.on('close', (code) => {
          if (code === 0) {
            console.log('\n✅ OAuth setup complete!\n');
            console.log('Run: npx evobrew start\n');
          } else {
            console.log('\n⚠️  OAuth setup cancelled or failed');
            console.log('   You can run it later: node import-oauth.js');
            console.log('   Or use API keys: set ANTHROPIC_OAUTH_ONLY=false in .env\n');
          }
          process.exit(code);
        });
        
        return;
      } catch (err) {
        console.log('❌ Could not launch OAuth setup:', err.message);
        console.log('   Try manually: node import-oauth.js\n');
      }
    } else {
      console.log('\n💡 To use Anthropic without OAuth:');
      console.log('   Set ANTHROPIC_OAUTH_ONLY=false in .env\n');
    }
  }

  // Done!
  rl.close();
  console.log('════════════════════════════════════════════════');
  console.log('✅ Setup Complete!');
  console.log('════════════════════════════════════════════════\n');
  console.log('Start Evobrew:   npx evobrew start');
  console.log('View config:     npx evobrew config\n');
  
  return true;
}

module.exports = { setupWizard };
