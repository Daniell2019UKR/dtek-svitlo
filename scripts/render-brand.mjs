import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {brandSvg} from '../public/brand/mark.js';

const directory=new URL('../public/brand/',import.meta.url);
await mkdir(directory,{recursive:true});
await writeFile(new URL('logo.svg',directory),`${brandSvg()}\n`);
await writeFile(new URL('favicon.svg',directory),`${brandSvg({background:true})}\n`);

const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try {
 const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});
 await page.route('**/*',route=>route.abort());
 for(const {filename,background,size} of [
  {filename:'avatar.png',background:true,size:1024},
  {filename:'logo-transparent.png',background:false,size:1024},
  {filename:'favicon.png',background:true,size:64}
 ]) {
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${brandSvg({background,size})}`);
  await page.locator('svg').screenshot({path:fileURLToPath(new URL(filename,directory)),type:'png',omitBackground:!background});
  console.log(`Rendered public/brand/${filename} (${size} × ${size})`);
 }
} finally {await browser.close();}
