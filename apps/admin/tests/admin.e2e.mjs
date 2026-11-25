#!/usr/bin/env node
/**
 * Jornada comportamental do Admin. GIS, Supabase e FastAPI são falsos somente
 * neste processo de Chrome; o build nunca contém esses mocks.
 *
 * Uso: node tests/admin.e2e.mjs http://localhost:5195 ./screens
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "../../web/scripts/lib/cdp.mjs";

const base = (process.argv[2] ?? "http://localhost:5195").replace(/\/$/, "");
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });

const b = await launch();
const failures = [];
const check = async (value, description) => {
  if (value) console.log(`  ✓ ${description}`);
  else {
    failures.push(description);
    console.log(`  ✗ ${description}`);
  }
};
const waitFor = async (expression, timeout = 6000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (await b.evaluate(expression)) return true; } catch {}
    await sleep(100);
  }
  return false;
};
const click = (selector) => b.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click() ?? false`);
const setJustification = (value) => b.evaluate(`(() => { const area = document.querySelector('textarea'); if (!area) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, ${JSON.stringify(value)}); area.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

const MOCK = `(() => {
  const encode = (value) => btoa(JSON.stringify(value)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
  const token = () => encode({alg:"RS256",typ:"JWT"}) + "." + encode({sub:"admin-e2e",aud:"authenticated",exp:Math.floor(Date.now()/1000)+3600}) + ".test";
  const user = { id:"11111111-1111-4111-8111-111111111111", aud:"authenticated", role:"authenticated", email:"admin@example.test", email_confirmed_at:"2026-01-01T00:00:00Z", app_metadata:{provider:"google"}, user_metadata:{full_name:"Admin de teste"} };
  const session = () => ({access_token:token(),refresh_token:"refresh-test",token_type:"bearer",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
  const documentNumber = Number(sessionStorage.getItem("admin-e2e-document") || "0") + 1;
  sessionStorage.setItem("admin-e2e-document", String(documentNumber));
  const state = window.__adminE2E = { documentNumber, authorized:true, api401:false, api403:false, network:false, badNonce:false, posts:0, page:0, teacher:{id:"22222222-2222-4222-8222-222222222222",display_name:"Professora E2E",account_status:"active",verification_status:"pending",is_published:false,price_cents:9000} };
  let gisConfig;
  window.google = {accounts:{id:{
    initialize(config){ gisConfig=config; state.initialize=(state.initialize||0)+1; },
    renderButton(node){ const button=document.createElement("button"); button.type="button"; button.textContent="Continuar com o Google"; button.dataset.e2eGoogle=""; button.onclick=()=>{ const claim={iss:"https://accounts.google.com",aud:gisConfig.client_id,exp:Math.floor(Date.now()/1000)+3600,nonce:state.badNonce?"invalid":"valid"}; gisConfig.callback({credential:encode({alg:"RS256"})+"."+encode(claim)+".test"}); }; node.replaceChildren(button); },
    disableAutoSelect(){ state.autoSelectDisabled=true; }, cancel(){}
  }}};
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init={}) => {
    const url = String(input);
    if (state.network && url.includes("api.admin-e2e.test")) throw new TypeError("network down");
    if (url.includes("supabase-admin-e2e.test/auth/v1/token")) {
      if (state.badNonce) return new Response(JSON.stringify({error:"invalid_nonce"}),{status:400,headers:{"Content-Type":"application/json"}});
      return new Response(JSON.stringify(session()),{status:200,headers:{"Content-Type":"application/json"}});
    }
    if (url.includes("supabase-admin-e2e.test/auth/v1/logout")) return new Response(null,{status:204});
    if (url.includes("api.admin-e2e.test/v1/admin/") && state.api401) return new Response("",{status:401});
    if (url.includes("api.admin-e2e.test/v1/admin/me")) {
      if (!state.authorized) return new Response("",{status:403});
      return Response.json({id:user.id,role:"operations_admin"});
    }
    if (url.includes("api.admin-e2e.test/v1/admin/teachers/") && (init.method||"GET")==="POST") {
      state.posts++;
      if (state.api403) return new Response("",{status:403});
      const action=url.split("/").at(-1);
      if(action==="approve"){state.teacher.verification_status="approved";state.teacher.is_published=true;}
      if(action==="reject"){state.teacher.verification_status="rejected";state.teacher.is_published=false;}
      if(action==="suspend") state.teacher.account_status="suspended";
      if(action==="reactivate") state.teacher.account_status="active";
      return Response.json(state.teacher);
    }
    if (url.includes("api.admin-e2e.test/v1/admin/teachers")) return Response.json({items:[state.teacher],limit:25,offset:state.page*25});
    if (url.includes("api.admin-e2e.test/v1/admin/dashboard")) return Response.json({students:2,teachers:1,payments_paid:1,confirmed_volume_cents:9000});
    if (url.includes("api.admin-e2e.test/v1/admin/")) return Response.json({items:[],limit:25,offset:state.page*25});
    return originalFetch(input,init);
  };
})();`;

await b.send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
await b.go(base);
await check(await waitFor("!!document.querySelector('[data-e2e-google]')"), "tela de login e GIS simulado disponíveis");
await click("[data-e2e-google]");
await check(await waitFor("document.querySelector('aside')?.textContent.includes('EduSearch Admin')"), "login autorizado valida /v1/admin/me");
await check(await b.evaluate("window.__adminE2E.initialize === 1"), "GIS inicializado uma única vez");

const documentNumber = () => b.evaluate("Number(sessionStorage.getItem('admin-e2e-document') || 0)");
const waitForNewDocument = (previous) => waitFor(`Number(sessionStorage.getItem('admin-e2e-document') || 0) > ${previous} && !!document.querySelector('[data-e2e-google]')`);
const logOutDocument = await documentNumber();
await b.evaluate("[...document.querySelectorAll('button')].find((b)=>b.textContent==='Sair')?.click()");
await check(await waitForNewDocument(logOutDocument), "logout remove a sessão e reinicia a jornada administrativa");
await click("[data-e2e-google]");
await check(await waitFor("document.querySelector('aside')?.textContent.includes('EduSearch Admin')"), "novo login após logout valida o servidor");

for (const path of ["/students", "/teachers", "/lessons", "/payments", "/payout-accounts", "/notifications", "/audit", "/administrators"]) {
  await b.go(base + path);
  await check(await waitFor("!document.querySelector('[role=status]')"), `navegação administrativa ${path}`);
}

await b.go(base + "/teachers");
await check(await waitFor("!![...document.querySelectorAll('button')].find((b)=>b.textContent==='Aprovar')"), "professor pendente expõe aprovação");
await b.evaluate("[...document.querySelectorAll('button')].find((b)=>b.textContent==='Aprovar')?.click()");
await check(await waitFor("!!document.querySelector('[role=dialog]')"), "confirmação de ação administrativa");
await setJustification("Documentos verificados");
await b.evaluate("[...document.querySelectorAll('[role=dialog] button')].find((b)=>b.textContent==='Confirmar')?.click()");
await check(await waitFor("!document.querySelector('[role=dialog]') && window.__adminE2E.posts===1"), "aprovação atualiza a listagem sem reenvio");

// Exercita as outras transições reais com o mesmo endpoint; cada caso começa no estado aplicável.
for (const [state, label] of [["pending", "Rejeitar"], ["approved", "Suspender"], ["suspended", "Reativar"]]) {
  await b.evaluate(`window.__adminE2E.teacher.account_status=${JSON.stringify(state === "suspended" ? "suspended" : "active")};window.__adminE2E.teacher.verification_status=${JSON.stringify(state)};history.pushState({},'', '/students');window.dispatchEvent(new PopStateEvent('popstate'));setTimeout(()=>{history.pushState({},'', '/teachers');window.dispatchEvent(new PopStateEvent('popstate'))}, 50)`);
  await waitFor(`!![...document.querySelectorAll('button')].find((b)=>b.textContent===${JSON.stringify(label)})`);
  await b.evaluate(`([...document.querySelectorAll('button')].find((b)=>b.textContent===${JSON.stringify(label)}))?.click()`);
  await waitFor("!!document.querySelector('[role=dialog]')");
  await setJustification("Operação autorizada");
  await b.evaluate("[...document.querySelectorAll('[role=dialog] button')].find((b)=>b.textContent==='Confirmar')?.click()");
  await check(await waitFor("!document.querySelector('[role=dialog]')"), `${label.toLowerCase()} envia uma mutação única`);
}

await b.evaluate("window.__adminE2E.api403=true;window.__adminE2E.teacher.verification_status='pending';window.__adminE2E.teacher.account_status='active';window.dispatchEvent(new PopStateEvent('popstate'))");
await b.evaluate("history.pushState({},'', '/students');window.dispatchEvent(new PopStateEvent('popstate'));setTimeout(()=>{history.pushState({},'', '/teachers');window.dispatchEvent(new PopStateEvent('popstate'))}, 50)");
await waitFor("!![...document.querySelectorAll('button')].find((b)=>b.textContent==='Aprovar')");
await b.evaluate("[...document.querySelectorAll('button')].find((b)=>b.textContent==='Aprovar')?.click()");
await setJustification("Sem permissão");
await b.evaluate("[...document.querySelectorAll('[role=dialog] button')].find((b)=>b.textContent==='Confirmar')?.click()");
await check(await waitFor("document.body.textContent.includes('não possui permissão')"), "HTTP 403 fica restrito à operação");

await b.evaluate("window.__adminE2E.api403=false;window.__adminE2E.network=true;history.replaceState({},'', '/payments');window.dispatchEvent(new PopStateEvent('popstate'))");
await check(await waitFor("document.body.textContent.includes('Não foi possível carregar os dados')"), "falha de rede apresenta estado de erro");
await b.evaluate("window.__adminE2E.network=false;window.__adminE2E.api401=true;[...document.querySelectorAll('a')].find((a)=>a.getAttribute('href')==='/students')?.click()");
await check(await waitFor("document.querySelector('.gate h1')?.textContent.includes('Acesso administrativo')"), "HTTP 401 encerra a sessão administrativa");

const rejectedDocument = await documentNumber();
await b.evaluate("window.__adminE2E.api401=false;window.__adminE2E.badNonce=true");
await click("[data-e2e-google]");
await check(await waitForNewDocument(rejectedDocument), "nonce inválido reinicia o documento antes de nova tentativa");
await check(await b.evaluate("!document.querySelector('aside') && !!document.querySelector('[data-e2e-google]')"), "nonce inválido não cria sessão");
await b.evaluate("window.__adminE2E.badNonce=false;window.__adminE2E.authorized=false");
await click("[data-e2e-google]");
await check(await waitFor("document.body.textContent.includes('Acesso restrito') && !document.querySelector('aside')"), "conta sem RBAC recebe acesso restrito");

for (const [width, dark] of [[1440,false],[768,true],[390,false],[320,true]]) {
  await b.viewport(width, { dark });
  await b.go(base + "/teachers");
  await check(await waitFor("!!document.querySelector('aside') && !document.querySelector('[role=status]')"), `painel autorizado carregado em ${width}px`);
  const geometry = await b.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth");
  await check(geometry, `sem overflow horizontal em ${width}px`);
  if (shots) await b.screenshot(join(shots, `admin-${width}-${dark ? "dark" : "light"}.png`));
}

await b.close();
if (failures.length || b.errors.length) {
  console.error([...failures, ...b.errors].join("\n"));
  process.exitCode = 1;
} else console.log("Admin E2E: concluído.");
