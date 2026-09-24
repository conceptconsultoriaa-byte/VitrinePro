function brl(v){ return "R$ " + Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2}); }
function contrastInk(hex){
  const num = parseInt(hex.slice(1),16);
  const r=(num>>16)&255, g=(num>>8)&255, b=num&255;
  const brightness = (r*299 + g*587 + b*114) / 1000;
  return brightness > 150 ? "#101010" : "#F5F5EF";
}

const params = new URLSearchParams(window.location.search);
const slug = params.get("loja");
let LOJA = null;
let PRODUTOS = [];
let CARRINHO = []; // { produto_id, nome, preco, quantidade }

async function iniciar(){
  if(!slug){ document.getElementById("vitrineHeader").innerHTML = "<p class='hint'>Link inválido.</p>"; return; }

  const { data, error } = await supabaseClient.rpc("get_vitrine_publica", { p_slug: slug }).maybeSingle();
  if(error || !data){ document.getElementById("vitrineHeader").innerHTML = "<p class='hint'>Vitrine não encontrada.</p>"; return; }
  LOJA = data;

  if(LOJA.cor){
    document.documentElement.style.setProperty("--lime", LOJA.cor);
    document.documentElement.style.setProperty("--lime-ink", contrastInk(LOJA.cor));
  }
  document.getElementById("vitrineHeader").innerHTML = `
    ${LOJA.logo ? `<img src="${LOJA.logo}" alt="${LOJA.nome}">` : ""}
    <h1>${LOJA.nome}</h1>
    <p class="hint">Escolha os produtos, adicione ao pedido e finalize abaixo.</p>
  `;

  const { data: prods } = await supabaseClient.from("produtos").select("*").eq("business_id", LOJA.business_id).eq("ativo", true).order("created_at");
  PRODUTOS = prods || [];
  renderGrid();
}

function renderGrid(){
  const el = document.getElementById("produtosGrid");
  el.innerHTML = "";
  if(PRODUTOS.length === 0){ el.innerHTML = "<p class='hint' style='grid-column:1/-1;'>Nenhum produto disponível no momento.</p>"; return; }
  PRODUTOS.forEach(p=>{
    const card = document.createElement("div");
    card.className = "produto-card";
    card.innerHTML = `
      ${p.foto_url ? `<img src="${p.foto_url}" alt="${p.nome}">` : `<div style="height:150px;background:var(--surface-2);"></div>`}
      <div class="info">
        <span class="nome">${p.nome}</span>
        <span class="preco">${brl(p.preco)}</span>
        <div class="add-row">
          <input type="number" min="1" value="1" id="qtd-${p.id}">
          <button class="btn-primary">Adicionar</button>
        </div>
      </div>`;
    card.querySelector("button").addEventListener("click", ()=>{
      const qtd = Math.max(1, parseInt(document.getElementById(`qtd-${p.id}`).value, 10) || 1);
      adicionarAoCarrinho(p, qtd);
    });
    el.appendChild(card);
  });
}

function adicionarAoCarrinho(produto, quantidade){
  const existente = CARRINHO.find(i=>i.produto_id === produto.id);
  if(existente) existente.quantidade += quantidade;
  else CARRINHO.push({ produto_id: produto.id, nome: produto.nome, preco: produto.preco, quantidade });
  atualizarCartBar();
}

function atualizarCartBar(){
  const bar = document.getElementById("cartBar");
  const totalItens = CARRINHO.reduce((s,i)=>s+i.quantidade,0);
  const total = CARRINHO.reduce((s,i)=>s+i.quantidade*i.preco,0);
  if(totalItens === 0){ bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  document.getElementById("cartResumo").textContent = `${totalItens} ite${totalItens>1?"ns":"m"} · ${brl(total)}`;
}

function renderCartModal(){
  const el = document.getElementById("cartItens");
  el.innerHTML = "";
  CARRINHO.forEach(i=>{
    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `<span>${i.quantidade}x ${i.nome}</span><span>${brl(i.quantidade*i.preco)}</span>`;
    el.appendChild(div);
  });
  const total = CARRINHO.reduce((s,i)=>s+i.quantidade*i.preco,0);
  document.getElementById("cartTotal").textContent = brl(total);
  const hoje = new Date();
  document.getElementById("ckData").min = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,"0")}-${String(hoje.getDate()).padStart(2,"0")}`;
}

document.getElementById("btnVerCarrinho").addEventListener("click", ()=>{
  renderCartModal();
  document.getElementById("cartModal").classList.remove("hidden");
});
document.getElementById("btnFecharCarrinho").addEventListener("click", ()=>{
  document.getElementById("cartModal").classList.add("hidden");
});

document.getElementById("checkoutForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const nome = document.getElementById("ckNome").value.trim();
  const telefone = document.getElementById("ckTelefone").value.trim().replace(/\D/g,"");
  const endereco = document.getElementById("ckEndereco").value.trim();
  const data = document.getElementById("ckData").value;
  const msg = document.getElementById("checkoutMsg");
  if(!nome || !telefone || CARRINHO.length === 0){ msg.textContent = "Preencha seu nome e WhatsApp."; return; }

  const itens = CARRINHO.map(i=>({ produto_id: i.produto_id, quantidade: i.quantidade }));
  const { data: pedidoId, error } = await supabaseClient.rpc("criar_pedido", {
    p_business_id: LOJA.business_id,
    p_cliente_nome: nome,
    p_cliente_telefone: telefone,
    p_endereco: endereco || null,
    p_data_entrega: data || null,
    p_itens: itens
  });
  if(error){ msg.textContent = "Erro ao enviar pedido: " + error.message; return; }

  if(LOJA.whatsapp){
    const resumo = CARRINHO.map(i=>`${i.quantidade}x ${i.nome}`).join(", ");
    const ownerMsg = `Novo pedido de ${nome} (${telefone}): ${resumo}.${endereco ? " Entregar em: " + endereco + "." : ""}`;
    window.open(`https://wa.me/${LOJA.whatsapp.replace(/\D/g,"")}?text=${encodeURIComponent(ownerMsg)}`, "_blank");
  }

  document.getElementById("cartModal").classList.add("hidden");
  CARRINHO = [];
  atualizarCartBar();
  document.getElementById("vitrineHeader").innerHTML = `<h1>Pedido enviado! ✅</h1><p class="hint">${LOJA.nome} já recebeu seu pedido e vai te chamar no WhatsApp com o link de pagamento.</p>`;
  document.getElementById("produtosGrid").innerHTML = "";
});

iniciar();
