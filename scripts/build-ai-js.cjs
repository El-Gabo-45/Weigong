#!/usr/bin/env node
/**
 * build-ai-js.cjs - Strip TypeScript syntax from engine/ai/*.ts to create browser-compatible .js files
 * 
 * This script reads .ts files from engine/ai/, strips TypeScript-specific syntax
 * (import type, type annotations, interface, etc.), and writes clean .js files.
 */
const fs = require('fs');
const path = require('path');

const AI_DIR = path.join(__dirname, '..', 'engine', 'ai');

function stripTypeScript(content) {
  let result = content;
  
  // Remove 'import type' statements entirely (they're type-only imports)
  result = result.replace(/^import\s+type\s+\{[^}]*\}\s*from\s*['"][^'"]*['"]\s*;?\s*$/gm, '');
  result = result.replace(/^import\s+type\s+\w+\s+from\s*['"][^'"]*['"]\s*;?\s*$/gm, '');
  
  // Remove 'export type' statements
  result = result.replace(/^export\s+type\s+\{[^}]*\}\s*;?\s*$/gm, '');
  
  // Remove interface declarations
  result = result.replace(/^export\s+interface\s+\w+\s*\{[\s\S]*?\n\}/gm, '');
  result = result.replace(/^interface\s+\w+\s*\{[\s\S]*?\n\}/gm, '');
  
  // Remove type annotations from function parameters: (param: Type) -> (param)
  result = result.replace(/:\s*(string|number|boolean|void|any|never|null|undefined|bigint|symbol|unknown|Record<[^>]+>|Set<[^>]+>|Map<[^>]+>|Array<[^>]+>|\[\]|\([^)]*\)\s*=>\s*\w+)\b/g, '');
  
  // Remove return type annotations: ): ReturnType -> )
  // This is a simplified approach
  
  // Remove 'as const' assertions
  result = result.replace(/\s+as\s+const/g, '');
  
  // Remove 'readonly' modifier
  result = result.replace(/\breadonly\b\s+/g, '');
  
  return result;
}

const tsFiles = fs.readdirSync(AI_DIR).filter(f => f.endsWith('.ts'));

for (const file of tsFiles) {
  const tsPath = path.join(AI_DIR, file);
  const jsPath = path.join(AI_DIR, file.replace('.ts', '.js'));
  
  const content = fs.readFileSync(tsPath, 'utf-8');
  const stripped = stripTypeScript(content);
  
  fs.writeFileSync(jsPath, stripped, 'utf-8');
  console.log(`Built: ${file} -> ${file.replace('.ts', '.js')}`);
}

console.log(`\nDone! Built ${tsFiles.length} files.`);