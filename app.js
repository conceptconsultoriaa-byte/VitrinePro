/* ===========================================================
   VitrinePro — painel do assinante (Supabase: multi-tenant real)
   Cada login = um "business" isolado por Row Level Security.
   Vitrine de produtos com carrinho, pedido e pagamento com conta conectada.
   =========================================================== */

const SEGMENTS = {
  semijoia:   { label: "Semijoias / Acessórios" },
  roupa:      { label: "Roupas / Moda" },
  cosmetico:  { label: "Cosméticos / Perfumaria" },
  hortifruti: { label: "Hortifruti / Mercado" },
  outro:      { label: "Outro segmento" }
};
const BACKEND_URL = "https://agendapro-backend-1n92.onrender.com";
const PLAN_LIMITS = { basico: { produtos: 15, relatorioCompleto: false, logoPersonalizado: false },
                       pro:    { produtos: 50, relatorioCompleto: true,  logoPersonalizado: true } };
function planoAtual(){
  // Sem plano escolhido ainda (trial) = mesmos limites do Pro, pra poder avaliar o app antes de assinar.
  return PLAN_LIMITS[BUSINESS.subscription_plan] || PLAN_LIMITS.pro;
}

let CURRENT_USER = null;
let BUSINESS = null;
let PRODUTOS = [];
let PEDIDOS = [];

function brl(v){ return "R$ " + Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2}); }
function pad(n){ return String(n).padStart(2,"0"); }
function dateKey(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function formatDateBR(dateStr){ if(!dateStr) return "—"; const [y,m,d] = dateStr.split("-"); return `${d}/${m}/${y}`; }

/* ---------------- AUTH / BOOTSTRAP ---------------- */
async function boot(){
  const { data: { session } } = await supabaseClient.auth.getSession();
  if(!session){ window.location.href = "login.html"; return; }
  CURRENT_USER = session.user;
  await loadOrCreateBusiness();
  if(isSubscriptionBlocked()){ renderSubscriptionGate(); return; }
  await loadAll();
  fillConfigForm();
  refreshAll();
  await renderSponsorBanner();

  const mpParam = new URLSearchParams(window.location.search).get("mp");
  if(mpParam){
    if(mpParam === "conectado") alert("Mercado Pago conectado com sucesso! Os pagamentos dos seus clientes já caem direto na sua conta.");
    else if(mpParam === "erro") alert("Não foi possível conectar o Mercado Pago. Tente novamente.");
    window.history.replaceState({}, "", window.location.pathname);
  }
}

/* ---------------- PATROCINADOR ---------------- */
async function renderSponsorBanner(){
  const { data } = await supabaseClient.from("patrocinadores").select("*").eq("produto", "vitrinepro").eq("ativo", true).limit(1).maybeSingle();
  const el = document.getElementById("sponsorBanner");
  if(!data){ el.innerHTML = ""; return; }
  el.innerHTML = `<div class="sponsor-banner">
    ${data.logo_url ? `<img src="${data.logo_url}" alt="${data.nome}">` : ""}
    <span class="label">Patrocinado por</span> <a href="${data.link_url || '#'}" target="_blank" rel="noopener"><strong>${data.nome}</strong></a>
  </div>`;
}

/* ---------------- ASSINATURA (Mercado Pago) ---------------- */
function isSubscriptionBlocked(){
  if(BUSINESS.subscription_status === "inadimplente" || BUSINESS.subscription_status === "cancelado") return true;
  if(BUSINESS.subscription_status === "trial" && !BUSINESS.subscription_plan && BUSINESS.trial_expires_at && new Date(BUSINESS.trial_expires_at) < new Date()) return true;
  return false;
}
function trialExpirado(){
  return BUSINESS.subscription_status === "trial" && !BUSINESS.subscription_plan && BUSINESS.trial_expires_at && new Date(BUSINESS.trial_expires_at) < new Date();
}

async function iniciarAssinatura(plano){
  try{
    const resp = await fetch(`${BACKEND_URL}/api/assinatura/criar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: BUSINESS.id, email: CURRENT_USER.email, plano, produto: "vitrinepro" })
    });
    const data = await resp.json();
    if(data.link){ window.location.href = data.link; }
    else { alert("Não foi possível iniciar a assinatura: " + (data.error || "tente novamente em instantes.")); }
  }catch(err){
    alert("Erro de conexão com o servidor de pagamento. Tente novamente em instantes.");
  }
}

function renderSubscriptionGate(){
  document.querySelector(".tabs").style.display = "none";
  const titulo = trialExpirado() ? "Seu teste grátis de 30 dias acabou" : "Assinatura pendente";
  const msg = trialExpirado()
    ? "Esperamos que tenha gostado! Escolha um plano abaixo pra continuar usando o VitrinePro."
    : `Sua assinatura do VitrinePro está <strong>${BUSINESS.subscription_status}</strong>. Escolha um plano abaixo para voltar a usar o app.`;
  document.querySelector(".content").innerHTML = `
    <h1>${titulo}</h1>
    <p class="hint">${msg}</p>
    <div class="cards">
      <div class="card">
        <span class="card-label">Básico — R$ 49/mês</span>
        <span class="hint">Até 15 produtos na vitrine.</span>
        <button class="btn-primary" id="gateBasico" style="margin-top:10px;">Assinar Básico</button>
      </div>
      <div class="card">
        <span class="card-label">Pro — R$ 89/mês</span>
        <span class="hint">Até 50 produtos, relatório completo, marca personalizada.</span>
        <button class="btn-primary" id="gatePro" style="margin-top:10px;">Assinar Pro</button>
      </div>
    </div>
  `;
  document.getElementById("gateBasico").addEventListener("click", ()=> iniciarAssinatura("basico"));
  document.getElementById("gatePro").addEventListener("click", ()=> iniciarAssinatura("pro"));
}

document.getElementById("logoutBtn").addEventListener("click", async ()=>{
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

async function loadOrCreateBusiness(){
  let { data: biz } = await supabaseClient.from("businesses").select("*").eq("owner_id", CURRENT_USER.id).maybeSingle();
  if(!biz){
    const slug = "vitrine-" + Math.random().toString(36).slice(2,8);
    const { data: newBiz, error } = await supabaseClient.from("businesses")
      .insert({ owner_id: CURRENT_USER.id, slug, name: "Minha Vitrine", segment: "semijoia" })
      .select().single();
    if(error){ alert("Erro ao criar cadastro: " + error.message); return; }
    biz = newBiz;
  }
  BUSINESS = biz;
}

async function loadAll(){
  const [{ data: prods }, { data: peds }] = await Promise.all([
    supabaseClient.from("produtos").select("*").eq("business_id", BUSINESS.id).order("created_at", { ascending: false }),
    supabaseClient.from("pedidos").select("*, itens_pedido(*)").eq("business_id", BUSINESS.id).order("created_at", { ascending: false })
  ]);
  PRODUTOS = prods || [];
  PEDIDOS = peds || [];
}

/* ---------------- TABS ---------------- */
document.querySelectorAll(".tab-btn[data-tab]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab-btn[data-tab]").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-"+btn.dataset.tab).classList.add("active");
    refreshAll();
  });
});

/* ---------------- THEME / BRAND ---------------- */
function applyBrand(){
  document.documentElement.setAttribute("data-theme", "dark");
  const cor = BUSINESS.brand_color || "#C6E619";
  document.documentElement.style.setProperty("--lime", cor);
  document.documentElement.style.setProperty("--lime-ink", contrastInk(cor));
  document.getElementById("brandName").textContent = BUSINESS.name || "VitrinePro";
  const logoEl = document.getElementById("brandLogo");
  if(BUSINESS.logo_url){ logoEl.src = BUSINESS.logo_url; logoEl.classList.remove("hidden"); }
  else { logoEl.classList.add("hidden"); }
}
function renderMpStatus(){
  const statusEl = document.getElementById("mpStatusText");
  const btn = document.getElementById("mpConectarBtn");
  if(BUSINESS.mp_connected){
    statusEl.textContent = "✅ Conectado — os pagamentos dos seus clientes caem direto na sua conta.";
    btn.textContent = "Reconectar";
  } else {
    statusEl.textContent = "⚠️ Não conectado — conecte para poder cobrar seus clientes.";
    btn.textContent = "Conectar Mercado Pago";
  }
  btn.href = `${BACKEND_URL}/api/mp/conectar?produto=vitrinepro&id=${BUSINESS.id}`;
}
function contrastInk(hex){
  const num = parseInt(hex.slice(1),16);
  const r=(num>>16)&255, g=(num>>8)&255, b=num&255;
  const brightness = (r*299 + g*587 + b*114) / 1000;
  return brightness > 150 ? "#101010" : "#F5F5EF";
}

/* ---------------- CONFIG FORM ---------------- */
const cfgForm = document.getElementById("configForm");
function fillConfigForm(){
  document.getElementById("cfgNome").value = BUSINESS.name;
  document.getElementById("cfgSegmento").value = BUSINESS.segment;
  document.getElementById("cfgCor").value = BUSINESS.brand_color || "#C6E619";
  document.getElementById("cfgWhats").value = BUSINESS.whatsapp || "";
  document.getElementById("cfgSlug").value = BUSINESS.slug;
  updatePublicLink();
  renderSubStatus();
  const logoLiberado = planoAtual().logoPersonalizado;
  const logoInput = document.getElementById("cfgLogo");
  logoInput.disabled = !logoLiberado;
  document.getElementById("cfgLogoHint").textContent = logoLiberado ? "" : "Disponível no plano Pro.";
}

function renderSubStatus(){
  const badge = document.getElementById("subStatusBadge");
  const statusClassMap = { trial: "status-pendente", ativo: "status-pago", inadimplente: "status-cancelado", cancelado: "status-cancelado" };
  let texto = BUSINESS.subscription_status || "trial";
  if(BUSINESS.subscription_status === "trial" && !BUSINESS.subscription_plan && BUSINESS.trial_expires_at){
    const dias = Math.max(0, Math.ceil((new Date(BUSINESS.trial_expires_at) - new Date()) / 86400000));
    texto = `trial · ${dias} dia(s) restante(s)`;
  }
  badge.textContent = texto;
  badge.className = "status-badge " + (statusClassMap[BUSINESS.subscription_status] || "status-pendente");
}
document.getElementById("btnAssinarBasico").addEventListener("click", ()=> iniciarAssinatura("basico"));
document.getElementById("btnAssinarPro").addEventListener("click", ()=> iniciarAssinatura("pro"));
function updatePublicLink(){
  const url = `${window.location.origin}${window.location.pathname.replace("index.html","")}vitrine.html?loja=${BUSINESS.slug}`;
  document.getElementById("publicLinkText").textContent = url;
}
document.getElementById("copyLinkBtn").addEventListener("click", ()=>{
  navigator.clipboard.writeText(document.getElementById("publicLinkText").textContent);
  alert("Link copiado!");
});

cfgForm.addEventListener("submit", async e=>{
  e.preventDefault();
  const updates = {
    name: document.getElementById("cfgNome").value.trim() || "Minha Vitrine",
    segment: document.getElementById("cfgSegmento").value,
    brand_color: document.getElementById("cfgCor").value,
    whatsapp: document.getElementById("cfgWhats").value.trim(),
    slug: document.getElementById("cfgSlug").value.trim().toLowerCase()
  };
  const file = document.getElementById("cfgLogo").files[0];
  if(file && !planoAtual().logoPersonalizado){
    alert("Logotipo personalizado é exclusivo do plano Pro. Faça upgrade na seção Assinatura.");
    return;
  }
  if(file){
    const path = `${BUSINESS.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabaseClient.storage.from("logos").upload(path, file, { upsert: true });
    if(upErr){ alert("Erro ao enviar logo: " + upErr.message); return; }
    const { data: pub } = supabaseClient.storage.from("logos").getPublicUrl(path);
    updates.logo_url = pub.publicUrl;
  }
  const { data, error } = await supabaseClient.from("businesses").update(updates).eq("id", BUSINESS.id).select().single();
  if(error){ alert("Erro ao salvar (verifique se o link/slug já não está em uso): " + error.message); return; }
  BUSINESS = data;
  applyBrand(); updatePublicLink();
  alert("Configurações salvas.");
});

/* ---------------- COMPRESSÃO DE IMAGEM (deixa o app eficiente: fotos leves) ---------------- */
function comprimirImagem(file, maxLargura = 1000, qualidade = 0.8){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const reader = new FileReader();
    reader.onload = ()=>{ img.src = reader.result; };
    reader.onerror = reject;
    img.onload = ()=>{
      const escala = Math.min(1, maxLargura / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * escala;
      canvas.height = img.height * escala;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob)=> resolve(blob), "image/jpeg", qualidade);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------- PRODUTOS ---------------- */
let editingProdutoId = null;
document.getElementById("produtoForm").addEventListener("submit", async e=>{
  e.preventDefault();
  if(!editingProdutoId){
    const limite = planoAtual().produtos;
    if(PRODUTOS.length >= limite){
      alert(`Seu plano atual permite até ${limite} produtos na vitrine. Para cadastrar mais, faça upgrade em Configurações → Assinatura.`);
      return;
    }
  }
  const nome = document.getElementById("prodNome").value.trim();
  const preco = parseFloat(document.getElementById("prodPreco").value.replace(",","."));
  const file = document.getElementById("prodFoto").files[0];
  if(!nome || isNaN(preco)){ alert("Preencha nome e preço."); return; }

  let foto_url = null;
  if(file){
    const comprimida = await comprimirImagem(file);
    const path = `produtos/${BUSINESS.id}/${Date.now()}.jpg`;
    const { error: upErr } = await supabaseClient.storage.from("logos").upload(path, comprimida, { contentType: "image/jpeg" });
    if(upErr){ alert("Erro ao enviar foto: " + upErr.message); return; }
    const { data: pub } = supabaseClient.storage.from("logos").getPublicUrl(path);
    foto_url = pub.publicUrl;
  }

  let error;
  if(editingProdutoId){
    const payload = { nome, preco };
    if(foto_url) payload.foto_url = foto_url;
    ({ error } = await supabaseClient.from("produtos").update(payload).eq("id", editingProdutoId));
  } else {
    ({ error } = await supabaseClient.from("produtos").insert({ business_id: BUSINESS.id, nome, preco, foto_url, ativo: true }));
  }
  if(error){ alert("Erro ao salvar produto: " + error.message); return; }
  cancelarEdicaoProduto();
  await loadAll(); refreshAll();
});
function editarProduto(p){
  editingProdutoId = p.id;
  document.getElementById("prodNome").value = p.nome || "";
  document.getElementById("prodPreco").value = p.preco || "";
  document.getElementById("prodFoto").value = "";
  document.getElementById("produtoFormFotoHint").style.display = "block";
  const titulo = document.getElementById("produtoFormTitle");
  titulo.textContent = "Editando: " + p.nome;
  titulo.style.display = "block";
  document.getElementById("produtoFormSubmitBtn").textContent = "Salvar alterações";
  document.getElementById("produtoFormCancelBtn").style.display = "inline-block";
  document.getElementById("produtoForm").scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("prodNome").focus();
}
function cancelarEdicaoProduto(){
  editingProdutoId = null;
  document.getElementById("produtoForm").reset();
  document.getElementById("produtoFormFotoHint").style.display = "none";
  document.getElementById("produtoFormTitle").style.display = "none";
  document.getElementById("produtoFormSubmitBtn").textContent = "Cadastrar produto";
  document.getElementById("produtoFormCancelBtn").style.display = "none";
}
document.getElementById("produtoFormCancelBtn").addEventListener("click", cancelarEdicaoProduto);

function renderProdutosList(){
  const el = document.getElementById("produtosList");
  const limite = planoAtual().produtos;
  el.innerHTML = `<p class="hint">${PRODUTOS.length} de ${limite} produtos usados no seu plano.</p>`;
  if(PRODUTOS.length === 0){ el.insertAdjacentHTML("beforeend", "<p class='hint'>Nenhum produto cadastrado ainda.</p>"); return; }
  PRODUTOS.forEach(p=>{
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span>${p.foto_url ? `<img src="${p.foto_url}" alt="${p.nome}" style="height:44px;width:44px;object-fit:cover;border-radius:8px;vertical-align:middle;margin-right:10px;">` : ""}
      <strong>${p.nome}</strong> — ${brl(p.preco)} ${p.ativo ? `<span class="status-badge status-pago">Ativo</span>` : `<span class="status-badge status-cancelado">Inativo</span>`}</span>
      <span class="row-actions"></span>`;
    const actions = div.querySelector(".row-actions");
    const editBtn = document.createElement("button");
    editBtn.className = "btn-secondary"; editBtn.textContent = "Editar";
    editBtn.addEventListener("click", ()=> editarProduto(p));
    actions.appendChild(editBtn);
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "btn-secondary"; toggleBtn.textContent = p.ativo ? "Desativar" : "Ativar";
    toggleBtn.addEventListener("click", async ()=>{ await supabaseClient.from("produtos").update({ ativo: !p.ativo }).eq("id", p.id); await loadAll(); refreshAll(); });
    actions.appendChild(toggleBtn);
    const delBtn = document.createElement("button");
    delBtn.className = "btn-danger"; delBtn.textContent = "Excluir";
    delBtn.addEventListener("click", async ()=>{ if(confirm(`Excluir "${p.nome}"?`)){ await supabaseClient.from("produtos").delete().eq("id", p.id); await loadAll(); refreshAll(); } });
    actions.appendChild(delBtn);
    el.appendChild(div);
  });
}

/* ---------------- PEDIDOS ---------------- */
async function gerarLinkPagamentoPedido(pedido){
  try{
    const resp = await fetch(`${BACKEND_URL}/api/pagamento/criar-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descricao: `${BUSINESS.name} — Pedido`, valor: pedido.valor_total, agendamentoId: pedido.id, produto: "vitrinepro", ownerId: BUSINESS.id })
    });
    const data = await resp.json();
    if(data.error === "mp_nao_conectado"){ alert("Conecte sua conta do Mercado Pago em Configurações antes de cobrar seus clientes."); return; }
    if(!data.link){ alert("Erro ao gerar link de pagamento."); return; }
    const itens = (pedido.itens_pedido||[]).map(i=> `${i.quantidade}x ${i.produto_nome}`).join(", ");
    const msg = `Olá ${pedido.cliente_nome}! Segue o link de pagamento do seu pedido (${itens}), valor ${brl(pedido.valor_total)}: ${data.link}`;
    window.open(`https://wa.me/55${pedido.cliente_telefone}?text=${encodeURIComponent(msg)}`, "_blank");
    await supabaseClient.from("pedidos").update({ mp_link: data.link }).eq("id", pedido.id);
    await loadAll(); refreshAll();
  }catch(err){
    alert("Erro de conexão ao gerar o link de pagamento.");
  }
}

function renderPedidosList(){
  const el = document.getElementById("pedidosList");
  el.innerHTML = "";
  if(PEDIDOS.length === 0){ el.innerHTML = "<p class='hint'>Nenhum pedido recebido ainda.</p>"; return; }
  PEDIDOS.forEach(pedido=>{
    const itens = (pedido.itens_pedido||[]).map(i=> `${i.quantidade}x ${i.produto_nome}`).join(", ");
    const statusMap = { pendente: "status-pendente", pago: "status-pago", entregue: "status-pago", cancelado: "status-cancelado" };
    const div = document.createElement("div");
    div.className = "appointment-item";
    div.innerHTML = `<span>
        <strong>${pedido.cliente_nome}</strong> · ${pedido.cliente_telefone} · ${brl(pedido.valor_total)}
        <span class="status-badge ${statusMap[pedido.status]||'status-pendente'}">${pedido.status}</span><br>
        <span class="hint">${itens}${pedido.endereco_entrega ? " — Entregar em: " + pedido.endereco_entrega : ""}${pedido.data_entrega ? " — " + formatDateBR(pedido.data_entrega) : ""}</span>
      </span>
      <span class="row-actions"></span>`;
    const actions = div.querySelector(".row-actions");
    if(pedido.status === "pendente"){
      const cobrarBtn = document.createElement("a");
      cobrarBtn.className = "btn-whats"; cobrarBtn.href = "#"; cobrarBtn.textContent = "🔗 Cobrar";
      cobrarBtn.addEventListener("click", async (ev)=>{ ev.preventDefault(); await gerarLinkPagamentoPedido(pedido); });
      actions.appendChild(cobrarBtn);
    }
    if(pedido.status === "pago"){
      const entregueBtn = document.createElement("button");
      entregueBtn.className = "btn-secondary"; entregueBtn.textContent = "Marcar entregue";
      entregueBtn.addEventListener("click", async ()=>{ await supabaseClient.from("pedidos").update({ status: "entregue" }).eq("id", pedido.id); await loadAll(); refreshAll(); });
      actions.appendChild(entregueBtn);
    }
    if(pedido.status !== "cancelado" && pedido.status !== "entregue"){
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn-danger"; cancelBtn.textContent = "Cancelar";
      cancelBtn.addEventListener("click", async ()=>{ if(confirm("Cancelar este pedido?")){ await supabaseClient.from("pedidos").update({ status: "cancelado" }).eq("id", pedido.id); await loadAll(); refreshAll(); } });
      actions.appendChild(cancelBtn);
    }
    el.appendChild(div);
  });
}

/* ---------------- DASHBOARD ---------------- */
function renderDashboard(){
  const pendentes = PEDIDOS.filter(p=>p.status==="pendente");
  const aReceber = pendentes.reduce((s,p)=>s+Number(p.valor_total||0),0);
  const recebido = PEDIDOS.filter(p=>p.status==="pago" || p.status==="entregue").reduce((s,p)=>s+Number(p.valor_total||0),0);
  document.getElementById("statPedidosPendentes").textContent = pendentes.length;
  document.getElementById("statAReceber").textContent = brl(aReceber);
  document.getElementById("statRecebido").textContent = brl(recebido);
  document.getElementById("statProdutos").textContent = PRODUTOS.filter(p=>p.ativo).length;

  const badge = document.getElementById("badgePedidos");
  badge.textContent = pendentes.length;
  badge.classList.toggle("hidden", pendentes.length === 0);

  const el = document.getElementById("proximosPedidos");
  el.innerHTML = "";
  const recentes = PEDIDOS.slice(0, 8);
  if(recentes.length === 0){ el.innerHTML = "<p class='hint'>Nenhum pedido ainda.</p>"; return; }
  recentes.forEach(pedido=>{
    const itens = (pedido.itens_pedido||[]).map(i=> `${i.quantidade}x ${i.produto_nome}`).join(", ");
    const div = document.createElement("div");
    div.className = "appointment-item";
    div.innerHTML = `<span><strong>${pedido.cliente_nome}</strong> — ${itens} <span class="status-badge status-${pedido.status==='pendente'?'pendente':(pedido.status==='cancelado'?'cancelado':'pago')}">${pedido.status}</span></span>`;
    el.appendChild(div);
  });
}

/* ---------------- REFRESH ALL ---------------- */
function refreshAll(){
  applyBrand();
  renderMpStatus();
  renderProdutosList();
  renderPedidosList();
  renderDashboard();
  updatePublicLink();
}

/* ---------------- INIT ---------------- */
boot();
