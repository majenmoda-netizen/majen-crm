// Navegação simples entre as telas, usando o hash da URL (#viagens, #estoque...).
const ROUTES = ["painel", "viagens", "estoque", "fornecedores", "vendas", "clientes", "financeiro", "relatorios"];

function showRoute() {
  const hash = window.location.hash.replace("#", "");
  const route = ROUTES.includes(hash) ? hash : "painel";

  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active", screen.dataset.screen === route);
  });
  document.querySelectorAll(".sidebar nav a").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route);
  });
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const num = (value) => Number(value);

// Datas são digitadas como DIA/MÊS/ANO e guardadas em AAAA-MM-DD.
function parseDateBR(text) {
  const match = String(text || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Insere as barras enquanto a pessoa digita ou cola (ex.: 20102000 vira 20/10/2000).
function maskDateBR(input) {
  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "").slice(0, 8);
    let masked = digits;
    if (digits.length > 4) masked = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) masked = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    input.value = masked;
  });
}

// Data de hoje no fuso do computador (toISOString usaria UTC e viraria o dia à noite).
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const todayBR = () => formatDate(todayISO());

function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Forma de pagamento com as parcelas, quando houver (ex.: "Cartão de crédito (3x)").
const formaVenda = (v) => (v.parcelas > 1 ? `${v.forma} (${v.parcelas}x)` : v.forma);

// Nome do fornecedor pelo id; peças antigas podem ter só o nome digitado em texto.
const fornecedorNome = (id) => {
  const f = cache.fornecedores.find((x) => x.id === id);
  return f ? f.nome : "";
};
const fornecedorDe = (p) => fornecedorNome(p.fornecedorId) || p.fornecedorTexto || "";
const lojasTexto = (t) => t.fornecedorIds.map(fornecedorNome).filter(Boolean).join(", ") || "—";

// Cálculo da viagem: litros = km ÷ consumo; combustível = litros × preço;
// custo por peça = (combustível + pedágio) ÷ peças.
function calculateTrip({ km, consumo, preco, pedagio, pecas }) {
  const litros = km / consumo;
  const combustivel = litros * preco;
  const total = combustivel + pedagio;
  const porPeca = total / pecas;
  return { litros, combustivel, total, porPeca };
}

// Regras de preço: impostos + taxa da maquininha sobre a venda, e margem desejada.
// Preço mínimo = custo ÷ (1 − impostos − margem). Valores de exemplo, ajustáveis depois.
const PRICE_RULES = { impostosETaxa: 0.09, margemDesejada: 0.30 };

function suggestPrice(cost) {
  const raw = cost / (1 - PRICE_RULES.impostosETaxa - PRICE_RULES.margemDesejada);
  return Math.ceil(raw * 2) / 2; // arredonda para cima, em meio real
}

// Reduz a foto antes de enviar, para não pesar no banco.
function compressPhoto(file, maxSize = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// WhatsApp é a chave do cliente: guardamos só os dígitos, para evitar cadastro duplicado.
const onlyDigits = (value) => String(value || "").replace(/\D/g, "");

function totalSpent(client) {
  return client.compras.reduce((sum, c) => sum + c.valor, 0);
}

function lastPurchase(client) {
  return client.compras.reduce((last, c) => (!last || c.data > last ? c.data : last), "");
}

// ---------- Banco (Supabase) ----------

const config = window.MAJEN_CONFIG || {};
const db = config.supabaseUrl && config.supabaseAnonKey && window.supabase
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;

// Cópia local dos dados, carregada do banco depois do login.
const cache = { viagens: [], estoque: [], clientes: [], lancamentos: [], vendas: [], fornecedores: [] };
const renderers = [];

const tripFromRow = (r) => ({
  id: r.id,
  data: r.data,
  km: num(r.km),
  consumo: num(r.consumo),
  tipoCombustivel: r.tipo_combustivel,
  preco: num(r.preco),
  pedagio: num(r.pedagio),
  pecas: num(r.pecas),
  litros: num(r.litros),
  combustivel: num(r.combustivel),
  total: num(r.total),
  porPeca: num(r.por_peca),
  obs: r.obs || "",
  fornecedorIds: [],
});

const stockFromRow = (r) => ({
  id: r.id,
  nome: r.nome,
  categoria: r.categoria,
  tamanho: r.tamanho || "",
  cor: r.cor || "",
  codigo: r.codigo || "",
  criadoEm: (r.created_at || "").slice(0, 10),
  fornecedorId: r.fornecedor_id || null,
  fornecedorTexto: r.fornecedor || "",
  quantidade: num(r.quantidade),
  quantidadeInicial: num(r.quantidade_inicial ?? r.quantidade),
  viagemId: r.viagem_id,
  custoProduto: num(r.custo_produto),
  custoTransporte: num(r.custo_transporte),
  custoTotal: num(r.custo_total),
  precoVenda: num(r.preco_venda),
  foto: r.foto || "",
});

const clientFromRow = (r) => ({
  id: r.id,
  nome: r.nome,
  whatsapp: r.whatsapp,
  aniversario: r.aniversario || "",
  origem: r.origem || "",
  indicadaPor: r.indicada_por || "",
  tamanho: r.tamanho || "",
  perfume: r.perfume || "",
  estilo: r.estilo || "",
  consentWhats: !!r.consent_whats,
  consentPromo: !!r.consent_promo,
  obs: r.obs || "",
  compras: (r.compras || [])
    .map((c) => ({ id: c.id, data: c.data, valor: num(c.valor), descricao: c.descricao || "" }))
    .sort((a, b) => (a.data < b.data ? -1 : 1)),
});

const fornecedorFromRow = (r) => ({
  id: r.id,
  nome: r.nome,
  cidade: r.cidade || "",
  endereco: r.endereco || "",
  contato: r.contato || "",
  telefone: r.telefone || "",
  site: r.site || "",
  categorias: r.categorias || "",
  obs: r.obs || "",
});

const lancamentoFromRow = (r) => ({
  id: r.id,
  data: r.data,
  tipo: r.tipo,
  categoria: r.categoria,
  descricao: r.descricao || "",
  valor: num(r.valor),
  forma: r.forma_pagamento || "",
});

const vendaFromRow = (r) => ({
  id: r.id,
  data: r.data,
  clienteId: r.cliente_id,
  forma: r.forma_pagamento || "",
  total: num(r.total),
  parcelas: num(r.parcelas || 1),
  estornada: !!r.estornada_em,
  itens: (r.itens_venda || []).map((i) => ({
    estoqueId: i.estoque_id,
    quantidade: num(i.quantidade),
    preco: num(i.preco_unitario),
    custo: num(i.custo_unitario),
  })),
});

async function loadAll() {
  const [viagens, estoque, clientes, lancamentos] = await Promise.all([
    db.from("viagens").select("*").order("data", { ascending: false }).order("created_at", { ascending: false }),
    db.from("estoque").select("*").order("created_at", { ascending: false }),
    db.from("clientes").select("*, compras(*)").order("nome"),
    db.from("lancamentos").select("*").order("data", { ascending: false }),
  ]);
  const error = viagens.error || estoque.error || clientes.error || lancamentos.error;
  if (error) throw error;
  cache.viagens = viagens.data.map(tripFromRow);
  cache.estoque = estoque.data.map(stockFromRow);
  cache.clientes = clientes.data.map(clientFromRow);
  cache.lancamentos = lancamentos.data.map(lancamentoFromRow);

  // Vendas são carregadas à parte: se a tabela ainda não existir, o resto do app continua funcionando.
  const vendas = await db
    .from("vendas")
    .select("*, itens_venda(*)")
    .order("data", { ascending: false })
    .order("created_at", { ascending: false });
  cache.vendas = vendas.error ? [] : vendas.data.map(vendaFromRow);

  // Fornecedores e lojas das viagens também são carregados à parte, pelo mesmo motivo.
  const fornecedores = await db.from("fornecedores").select("*").order("nome");
  cache.fornecedores = fornecedores.error ? [] : fornecedores.data.map(fornecedorFromRow);
  const links = await db.from("viagem_fornecedores").select("*");
  const porViagem = {};
  (links.error ? [] : links.data).forEach((l) => {
    (porViagem[l.viagem_id] = porViagem[l.viagem_id] || []).push(l.fornecedor_id);
  });
  cache.viagens.forEach((t) => {
    t.fornecedorIds = porViagem[t.id] || [];
  });
}

async function refreshAll() {
  await loadAll();
  renderers.forEach((render) => render());
}

function friendlyError(error) {
  const detail = error && error.message ? ` (${error.message})` : "";
  return `Não foi possível salvar. Verifique a conexão e tente de novo.${detail}`;
}

// ---------- Viagens ----------

function initTrips() {
  const form = document.getElementById("trip-form");
  if (!form) return;

  const preview = document.getElementById("trip-preview");
  const message = document.getElementById("trip-message");
  const list = document.getElementById("trip-list");
  const storesBox = document.getElementById("trip-stores");
  form.elements.data.value = todayBR();
  maskDateBR(form.elements.data);

  function readInputs() {
    return {
      km: num(form.elements.km.value),
      consumo: num(form.elements.consumo.value),
      preco: num(form.elements.preco.value),
      pedagio: num(form.elements.pedagio.value || 0),
      pecas: num(form.elements.pecas.value),
    };
  }

  function isValid(values) {
    return values.km > 0 && values.consumo > 0 && values.preco > 0 && values.pecas > 0 && values.pedagio >= 0;
  }

  function renderPreview() {
    const values = readInputs();
    if (!isValid(values)) {
      preview.innerHTML = '<p class="muted">Preencha o preço do combustível e a quantidade de peças para ver o cálculo.</p>';
      return;
    }
    const r = calculateTrip(values);
    preview.innerHTML = `
      <div class="line"><span>Litros gastos</span><strong>${r.litros.toFixed(1)} L</strong></div>
      <div class="line"><span>Combustível</span><strong>${brl.format(r.combustivel)}</strong></div>
      <div class="line"><span>Pedágio</span><strong>${brl.format(values.pedagio)}</strong></div>
      <div class="line total"><span>Custo da viagem</span><strong>${brl.format(r.total)}</strong></div>
      <div class="line total"><span>Custo por peça</span><strong>${brl.format(r.porPeca)}</strong></div>
    `;
  }

  function renderList() {
    const trips = cache.viagens;
    if (trips.length === 0) {
      list.innerHTML = '<p class="muted">Nenhuma viagem registrada ainda.</p>';
      return;
    }
    const rows = trips
      .map((t) => `
        <tr>
          <td>${formatDate(t.data)}</td>
          <td>${escapeHtml(lojasTexto(t))}</td>
          <td>${t.km} km</td>
          <td>${brl.format(t.preco)}/L</td>
          <td>${t.pecas}</td>
          <td>${brl.format(t.total)}</td>
          <td><strong>${brl.format(t.porPeca)}</strong></td>
          <td><button class="link-btn" data-remove="${t.id}" type="button">Remover</button></td>
        </tr>`)
      .join("");
    list.innerHTML = `
      <table>
        <thead>
          <tr><th>Data</th><th>Lojas</th><th>Km</th><th>Combustível</th><th>Peças</th><th>Custo viagem</th><th>Por peça</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  form.addEventListener("input", renderPreview);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = readInputs();
    const dataIso = parseDateBR(form.elements.data.value);
    if (!dataIso || !isValid(values)) {
      message.textContent = "Confira a data (DD/MM/AAAA) e os campos obrigatórios.";
      return;
    }
    const r = calculateTrip(values);
    const { data: saved, error } = await db.from("viagens").insert({
      data: dataIso,
      km: values.km,
      consumo: values.consumo,
      tipo_combustivel: form.elements.tipoCombustivel.value,
      preco: values.preco,
      pedagio: values.pedagio,
      pecas: values.pecas,
      litros: r.litros,
      combustivel: r.combustivel,
      total: r.total,
      por_peca: r.porPeca,
      obs: form.elements.obs.value.trim() || null,
    }).select("id").single();
    if (error) {
      message.textContent = friendlyError(error);
      return;
    }
    const lojas = [...storesBox.querySelectorAll("input:checked")].map((input) => input.value);
    if (lojas.length > 0) {
      const { error: linkError } = await db
        .from("viagem_fornecedores")
        .insert(lojas.map((id) => ({ viagem_id: saved.id, fornecedor_id: id })));
      if (linkError) {
        message.textContent = `Viagem salva, mas as lojas não foram registradas. ${linkError.message}`;
        await refreshAll();
        return;
      }
    }
    storesBox.querySelectorAll("input:checked").forEach((input) => {
      input.checked = false;
    });
    message.textContent = "Viagem salva.";
    form.elements.pecas.value = "";
    form.elements.obs.value = "";
    await refreshAll();
    renderPreview();
  });

  list.addEventListener("click", async (event) => {
    const id = event.target.dataset.remove;
    if (!id) return;
    if (!window.confirm("Remover esta viagem do histórico?")) return;
    const { error } = await db.from("viagens").delete().eq("id", id);
    if (error) {
      message.textContent = friendlyError(error);
      return;
    }
    await refreshAll();
  });

  // Lojas cadastradas na aba Fornecedores, para marcar onde a viagem passou. Mantém as marcações ao atualizar.
  function renderStores() {
    const marcadas = new Set([...storesBox.querySelectorAll("input:checked")].map((input) => input.value));
    storesBox.innerHTML = cache.fornecedores.length
      ? cache.fornecedores
          .map((f) => `<label class="check"><input type="checkbox" value="${f.id}" ${marcadas.has(f.id) ? "checked" : ""}> ${escapeHtml(f.nome)}</label>`)
          .join("")
      : '<p class="muted small">Cadastre os fornecedores na aba Fornecedores.</p>';
  }

  renderers.push(renderList);
  renderers.push(renderStores);
  renderPreview();
}

// ---------- Estoque ----------

function initStock() {
  const form = document.getElementById("stock-form");
  if (!form) return;

  const tripSelect = document.getElementById("stock-trip");
  const preview = document.getElementById("stock-preview");
  const photoPreview = document.getElementById("stock-photo-preview");
  const message = document.getElementById("stock-message");
  const list = document.getElementById("stock-list");
  const search = document.getElementById("stock-search");
  let photoData = "";

  function fillTrips() {
    const previous = tripSelect.value;
    const options = cache.viagens
      .map((t) => `<option value="${t.id}">${formatDate(t.data)}${t.fornecedorIds.length ? ` · ${escapeHtml(lojasTexto(t))}` : ""} · ${brl.format(t.porPeca)} por peça</option>`)
      .join("");
    tripSelect.innerHTML = `<option value="">Sem viagem (custo só do produto)</option>${options}`;
    tripSelect.value = previous;
  }

  function currentCost() {
    const custoProduto = num(form.elements.custoProduto.value || 0);
    const trip = cache.viagens.find((t) => t.id === tripSelect.value);
    const custoTransporte = trip ? trip.porPeca : 0;
    return { custoProduto, custoTransporte, total: custoProduto + custoTransporte };
  }

  function renderPreview() {
    const c = currentCost();
    if (!form.elements.custoProduto.value) {
      preview.innerHTML = '<p class="muted">Informe o custo do produto para ver o preço sugerido.</p>';
      return;
    }
    const sugerido = suggestPrice(c.total);
    preview.innerHTML = `
      <div class="line"><span>Produto</span><strong>${brl.format(c.custoProduto)}</strong></div>
      <div class="line"><span>Transporte (viagem)</span><strong>${brl.format(c.custoTransporte)}</strong></div>
      <div class="line total"><span>Custo total</span><strong>${brl.format(c.total)}</strong></div>
      <div class="line total"><span>Preço sugerido</span><strong>${brl.format(sugerido)}</strong></div>
    `;
    if (!form.elements.precoVenda.value) {
      form.elements.precoVenda.placeholder = sugerido.toFixed(2).replace(".", ",");
    }
  }

  // Fornecedores cadastrados na aba Fornecedores; mantém a escolha atual ao atualizar.
  function fillSuppliers() {
    const select = form.elements.fornecedorId;
    const previous = select.value;
    select.innerHTML = `<option value="">Sem fornecedor</option>${cache.fornecedores
      .map((f) => `<option value="${f.id}">${escapeHtml(f.nome)}</option>`)
      .join("")}`;
    select.value = previous;
  }

  function renderList() {
    fillTrips();
    fillSuppliers();
    const term = search.value.trim().toLowerCase();
    const items = cache.estoque.filter(
      (p) => !term || [p.codigo, p.nome, fornecedorDe(p), p.cor, p.tamanho].some((field) => (field || "").toLowerCase().includes(term))
    );
    if (items.length === 0) {
      list.innerHTML = `<p class="muted">${term ? "Nenhuma peça encontrada." : "Nenhuma peça cadastrada ainda."}</p>`;
      return;
    }
    const rows = items
      .map((item) => `
        <tr>
          <td>${item.foto ? `<img class="thumb" src="${item.foto}" alt="">` : "—"}</td>
          <td>${escapeHtml(item.codigo || "—")}</td>
          <td>${escapeHtml(item.nome)}</td>
          <td>${escapeHtml(fornecedorDe(item) || "—")}</td>
          <td>${item.categoria}</td>
          <td>${escapeHtml(item.tamanho || "—")}</td>
          <td>${escapeHtml(item.cor || "—")}</td>
          <td>
            <button class="link-btn" data-adjust="${item.id}" data-delta="-1" type="button">−</button>
            <strong>${item.quantidade}</strong>
            <button class="link-btn" data-adjust="${item.id}" data-delta="1" type="button">+</button>
          </td>
          <td>${brl.format(item.custoTotal)}</td>
          <td><strong>${brl.format(item.precoVenda)}</strong></td>
          <td><button class="link-btn" data-remove="${item.id}" type="button">Remover</button></td>
        </tr>`)
      .join("");
    list.innerHTML = `
      <table>
        <thead>
          <tr><th>Foto</th><th>Código</th><th>Nome</th><th>Fornecedor</th><th>Categoria</th><th>Tamanho</th><th>Cor</th><th>Qtd</th><th>Custo</th><th>Venda</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  form.elements.foto.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    photoData = "";
    photoPreview.innerHTML = "";
    if (!file) return;
    try {
      photoData = await compressPhoto(file);
      photoPreview.innerHTML = `<img class="thumb large" src="${photoData}" alt="Prévia da foto">`;
    } catch (error) {
      message.textContent = "Não consegui ler esta foto. Tente outra.";
    }
  });

  form.addEventListener("input", renderPreview);
  tripSelect.addEventListener("change", () => {
    // Se a viagem passou numa loja só e o fornecedor ainda está em branco, já sugere essa loja.
    const trip = cache.viagens.find((t) => t.id === tripSelect.value);
    if (trip && trip.fornecedorIds.length === 1 && !form.elements.fornecedorId.value) {
      form.elements.fornecedorId.value = trip.fornecedorIds[0];
    }
    renderPreview();
  });
  search.addEventListener("input", renderList);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nome = form.elements.nome.value.trim();
    const quantidade = num(form.elements.quantidade.value);
    const custoProduto = num(form.elements.custoProduto.value);
    if (!nome || !(quantidade > 0) || form.elements.custoProduto.value === "") {
      message.textContent = "Confira nome, quantidade e custo do produto.";
      return;
    }
    const c = currentCost();
    const precoVenda = num(form.elements.precoVenda.value) || suggestPrice(c.total);
    const { error } = await db.from("estoque").insert({
      codigo: form.elements.codigo.value.trim() || null,
      fornecedor_id: form.elements.fornecedorId.value || null,
      quantidade_inicial: quantidade,
      nome,
      categoria: form.elements.categoria.value,
      tamanho: form.elements.tamanho.value.trim() || null,
      cor: form.elements.cor.value.trim() || null,
      quantidade,
      viagem_id: tripSelect.value || null,
      custo_produto: custoProduto,
      custo_transporte: c.custoTransporte,
      custo_total: c.total,
      preco_venda: precoVenda,
      foto: photoData || null,
    });
    if (error) {
      message.textContent = friendlyError(error);
      return;
    }
    message.textContent = "Peça salva.";
    form.reset();
    form.elements.quantidade.value = 1;
    photoData = "";
    photoPreview.innerHTML = "";
    await refreshAll();
    renderPreview();
  });

  list.addEventListener("click", async (event) => {
    const { adjust, delta, remove } = event.target.dataset;
    if (adjust) {
      const item = cache.estoque.find((i) => i.id === adjust);
      if (!item) return;
      const { error } = await db.from("estoque").update({ quantidade: Math.max(0, item.quantidade + num(delta)) }).eq("id", adjust);
      if (error) {
        message.textContent = friendlyError(error);
        return;
      }
    } else if (remove) {
      if (!window.confirm("Remover esta peça do estoque?")) return;
      const { error } = await db.from("estoque").delete().eq("id", remove);
      if (error) {
        message.textContent = friendlyError(error);
        return;
      }
    } else {
      return;
    }
    await refreshAll();
  });

  renderers.push(renderList);
  renderers.push(renderPreview);
}

// ---------- Clientes ----------

function initClients() {
  const form = document.getElementById("client-form");
  if (!form) return;

  maskDateBR(form.elements.aniversario);
  const message = document.getElementById("client-message");
  const list = document.getElementById("client-list");
  const search = document.getElementById("client-search");
  const birthdays = document.getElementById("client-birthdays");
  const detail = document.getElementById("client-detail");
  let selectedId = null;

  function renderBirthdays(clients) {
    const month = new Date().getMonth() + 1;
    const upcoming = clients
      .filter((c) => c.aniversario && Number(c.aniversario.split("-")[1]) === month)
      .sort((a, b) => Number(a.aniversario.slice(8)) - Number(b.aniversario.slice(8)));
    if (upcoming.length === 0) {
      birthdays.innerHTML = "";
      return;
    }
    const items = upcoming
      .map((c) => `<span class="pill">${escapeHtml(c.nome)} · ${formatDate(c.aniversario).slice(0, 5)}</span>`)
      .join("");
    birthdays.innerHTML = `<p class="muted small">Aniversariantes deste mês</p><div class="pills">${items}</div>`;
  }

  function renderList() {
    const clients = cache.clientes;
    renderBirthdays(clients);
    const term = search.value.trim().toLowerCase();
    const shown = clients
      .filter((c) => !term || c.nome.toLowerCase().includes(term) || c.whatsapp.includes(term))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (shown.length === 0) {
      list.innerHTML = '<p class="muted">Nenhum cliente encontrado.</p>';
      return;
    }
    const rows = shown
      .map((c) => `
        <tr>
          <td>${escapeHtml(c.nome)}</td>
          <td>${escapeHtml(c.whatsapp)}</td>
          <td>${formatDate(c.aniversario)}</td>
          <td>${c.compras.length}</td>
          <td>${brl.format(totalSpent(c))}</td>
          <td>${formatDate(lastPurchase(c))}</td>
          <td><button class="link-btn" data-open="${c.id}" type="button">Abrir</button></td>
        </tr>`)
      .join("");
    list.innerHTML = `
      <table>
        <thead>
          <tr><th>Nome</th><th>WhatsApp</th><th>Aniversário</th><th>Compras</th><th>Total gasto</th><th>Última compra</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderDetail() {
    const client = cache.clientes.find((c) => c.id === selectedId);
    if (!client) {
      detail.hidden = true;
      detail.innerHTML = "";
      return;
    }
    const history = client.compras.length
      ? client.compras
          .slice()
          .reverse()
          .map((c) => `<tr><td>${formatDate(c.data)}</td><td>${escapeHtml(c.descricao || "—")}</td><td>${brl.format(c.valor)}</td></tr>`)
          .join("")
      : '<tr><td colspan="3" class="muted">Nenhuma compra registrada.</td></tr>';
    const consent = [
      client.consentWhats ? "WhatsApp" : null,
      client.consentPromo ? "promoções" : null,
    ].filter(Boolean).join(", ") || "sem consentimento";
    detail.hidden = false;
    detail.innerHTML = `
      <div class="detail-head">
        <h2>${escapeHtml(client.nome)}</h2>
        <button class="link-btn" data-close="1" type="button">Fechar</button>
      </div>
      <p class="muted small">
        WhatsApp ${escapeHtml(client.whatsapp)} · Aniversário ${formatDate(client.aniversario)} ·
        Origem: ${escapeHtml(client.origem || "—")} · Tamanho: ${escapeHtml(client.tamanho || "—")} ·
        Perfume: ${escapeHtml(client.perfume || "—")} · Estilo: ${escapeHtml(client.estilo || "—")} ·
        Consentimento: ${consent}
      </p>
      ${client.obs ? `<p class="small">${escapeHtml(client.obs)}</p>` : ""}
      <p><strong>Total gasto:</strong> ${brl.format(totalSpent(client))} em ${client.compras.length} compra(s)</p>

      <h3>Registrar compra</h3>
      <form id="purchase-form" class="row purchase">
        <label>Data <input type="text" name="data" placeholder="DD/MM/AAAA" inputmode="numeric" maxlength="10" required></label>
        <label>Valor (R$) <input type="number" name="valor" min="0.01" step="0.01" required></label>
        <label>Descrição <input type="text" name="descricao" placeholder="Ex.: vestido floral"></label>
        <div class="actions"><button type="submit" class="btn">Adicionar</button><span id="purchase-message" class="muted"></span></div>
      </form>

      <h3>Histórico</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th></tr></thead>
          <tbody>${history}</tbody>
        </table>
      </div>`;

    const purchaseForm = document.getElementById("purchase-form");
    purchaseForm.elements.data.value = todayBR();
    maskDateBR(purchaseForm.elements.data);
    purchaseForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const purchaseMessage = document.getElementById("purchase-message");
      const valor = num(purchaseForm.elements.valor.value);
      const dataIso = parseDateBR(purchaseForm.elements.data.value);
      if (!dataIso || !(valor > 0)) {
        purchaseMessage.textContent = "Informe data (DD/MM/AAAA) e valor.";
        return;
      }
      const { error } = await db.from("compras").insert({
        cliente_id: selectedId,
        data: dataIso,
        valor,
        descricao: purchaseForm.elements.descricao.value.trim() || null,
      });
      if (error) {
        purchaseMessage.textContent = friendlyError(error);
        return;
      }
      await refreshAll();
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nome = form.elements.nome.value.trim();
    const whatsapp = onlyDigits(form.elements.whatsapp.value);
    if (!nome || whatsapp.length < 10) {
      message.textContent = "Informe nome e WhatsApp com DDD.";
      return;
    }
    const existing = cache.clientes.find((c) => c.whatsapp === whatsapp);
    if (existing) {
      message.textContent = `Já existe cliente com esse WhatsApp: ${existing.nome}.`;
      selectedId = existing.id;
      renderDetail();
      return;
    }
    const aniversarioIso = parseDateBR(form.elements.aniversario.value);
    if (form.elements.aniversario.value && !aniversarioIso) {
      message.textContent = "Confira o aniversário (DD/MM/AAAA).";
      return;
    }
    const consentWhats = form.elements.consentWhats.checked;
    const consentPromo = form.elements.consentPromo.checked;
    const { error } = await db.from("clientes").insert({
      nome,
      whatsapp,
      aniversario: aniversarioIso,
      origem: form.elements.origem.value || null,
      indicada_por: form.elements.indicadaPor.value.trim() || null,
      tamanho: form.elements.tamanho.value.trim() || null,
      perfume: form.elements.perfume.value.trim() || null,
      estilo: form.elements.estilo.value.trim() || null,
      consent_whats: consentWhats,
      consent_whats_em: consentWhats ? todayISO() : null,
      consent_promo: consentPromo,
      consent_promo_em: consentPromo ? todayISO() : null,
      obs: form.elements.obs.value.trim() || null,
    });
    if (error) {
      message.textContent = friendlyError(error);
      return;
    }
    message.textContent = "Cliente salvo.";
    form.reset();
    await refreshAll();
  });

  search.addEventListener("input", renderList);

  list.addEventListener("click", (event) => {
    const id = event.target.dataset.open;
    if (!id) return;
    selectedId = id;
    renderDetail();
    detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  detail.addEventListener("click", (event) => {
    if (event.target.dataset.close) {
      selectedId = null;
      renderDetail();
    }
  });

  renderers.push(renderList);
  renderers.push(renderDetail);
}

// ---------- Fornecedores ----------

// Números de um fornecedor: o que foi comprado, o que ainda está no estoque e o que já rendeu em vendas.
function supplierStats(fornecedor) {
  const pecas = cache.estoque.filter((p) => p.fornecedorId === fornecedor.id);
  const ids = new Set(pecas.map((p) => p.id));
  let vendidas = 0;
  let faturamento = 0;
  let lucro = 0;
  cache.vendas
    .filter((v) => !v.estornada)
    .forEach((v) =>
      v.itens.forEach((i) => {
        if (!ids.has(i.estoqueId)) return;
        vendidas += i.quantidade;
        faturamento += i.quantidade * i.preco;
        lucro += i.quantidade * (i.preco - i.custo);
      })
    );
  return {
    pecas,
    comprado: pecas.reduce((sum, p) => sum + p.quantidadeInicial, 0),
    valorComprado: pecas.reduce((sum, p) => sum + p.quantidadeInicial * p.custoProduto, 0),
    emEstoque: pecas.reduce((sum, p) => sum + p.quantidade, 0),
    vendidas,
    faturamento,
    lucro,
    viagens: cache.viagens
      .filter((t) => t.fornecedorIds.includes(fornecedor.id))
      .sort((a, b) => (a.data < b.data ? 1 : -1)),
  };
}

function initFornecedores() {
  const form = document.getElementById("supplier-form");
  if (!form) return;

  const message = document.getElementById("supplier-message");
  const list = document.getElementById("supplier-list");
  const search = document.getElementById("supplier-search");
  const detail = document.getElementById("supplier-detail");
  const title = document.getElementById("supplier-form-title");
  const submitButton = document.getElementById("supplier-submit");
  const cancelButton = document.getElementById("supplier-cancel");
  let selectedId = null;
  let editingId = null;

  function setEditing(id) {
    editingId = id;
    const f = cache.fornecedores.find((x) => x.id === id);
    title.textContent = f ? "Editar fornecedor" : "Novo fornecedor";
    submitButton.textContent = f ? "Salvar alterações" : "Salvar fornecedor";
    cancelButton.hidden = !f;
    ["nome", "cidade", "telefone", "contato", "site", "endereco", "categorias", "obs"].forEach((name) => {
      form.elements[name].value = f ? f[name] : "";
    });
  }

  function renderList() {
    const term = search.value.trim().toLowerCase();
    const shown = cache.fornecedores.filter(
      (f) => !term || [f.nome, f.cidade, f.categorias, f.contato].some((field) => (field || "").toLowerCase().includes(term))
    );
    if (shown.length === 0) {
      list.innerHTML = `<p class="muted">${term ? "Nenhum fornecedor encontrado." : "Nenhum fornecedor cadastrado ainda."}</p>`;
      return;
    }
    const rows = shown
      .map((f) => {
        const s = supplierStats(f);
        const ultima = s.viagens.length ? formatDate(s.viagens[0].data) : "—";
        return `
          <tr>
            <td>${escapeHtml(f.nome)}</td>
            <td>${escapeHtml(f.cidade || "—")}</td>
            <td>${escapeHtml(f.telefone || "—")}</td>
            <td>${s.viagens.length}</td>
            <td>${s.comprado}</td>
            <td>${moneyText(s.valorComprado)}</td>
            <td>${ultima}</td>
            <td><button class="link-btn" data-open="${f.id}" type="button">Abrir</button></td>
          </tr>`;
      })
      .join("");
    list.innerHTML = `
      <table>
        <thead>
          <tr><th>Nome</th><th>Cidade</th><th>Telefone</th><th>Viagens</th><th>Peças compradas</th><th>Valor comprado</th><th>Última visita</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderDetail() {
    const f = cache.fornecedores.find((x) => x.id === selectedId);
    if (!f) {
      detail.hidden = true;
      detail.innerHTML = "";
      return;
    }
    const s = supplierStats(f);
    const kpi = (label, value) => `<div class="card kpi"><span class="muted small">${label}</span><strong>${value}</strong></div>`;

    const viagens = s.viagens.length
      ? s.viagens
          .map((t) => {
            const outras = t.fornecedorIds.filter((id) => id !== f.id).map(fornecedorNome).filter(Boolean).join(", ");
            return `<tr><td>${formatDate(t.data)}</td><td>${t.km} km</td><td>${t.pecas}</td><td>${moneyText(t.total)}</td><td>${escapeHtml(outras || "—")}</td></tr>`;
          })
          .join("")
      : '<tr><td colspan="5" class="muted">Nenhuma viagem registrada com este fornecedor.</td></tr>';

    const pecas = s.pecas.length
      ? s.pecas
          .map(
            (p) => `<tr>
              <td>${escapeHtml(p.codigo || "—")}</td>
              <td>${escapeHtml(p.nome)}</td>
              <td>${p.quantidadeInicial}</td>
              <td>${p.quantidade}</td>
              <td>${moneyText(p.custoProduto)}</td>
              <td>${moneyText(p.precoVenda)}</td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="6" class="muted">Nenhuma peça comprada deste fornecedor.</td></tr>';

    const dados = [
      ["Cidade", f.cidade],
      ["Telefone", f.telefone],
      ["Contato", f.contato],
      ["Site/Instagram", f.site],
      ["Endereço", f.endereco],
      ["Vendem", f.categorias],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${escapeHtml(value)}`)
      .join(" · ");

    detail.hidden = false;
    detail.innerHTML = `
      <div class="detail-head">
        <h2>${escapeHtml(f.nome)}</h2>
        <span>
          <button class="link-btn" data-edit="${f.id}" type="button">Editar</button>
          <button class="link-btn" data-delete="${f.id}" type="button">Excluir</button>
          <button class="link-btn" data-close="1" type="button">Fechar</button>
        </span>
      </div>
      <p class="muted small">${dados || "Sem dados de contato cadastrados."}</p>
      ${f.obs ? `<p class="small">${escapeHtml(f.obs)}</p>` : ""}

      <div class="kpis">
        ${kpi("Peças compradas", String(s.comprado))}
        ${kpi("Valor em produtos", moneyText(s.valorComprado))}
        ${kpi("Em estoque agora", String(s.emEstoque))}
        ${kpi("Peças vendidas", String(s.vendidas))}
        ${kpi("Faturamento", moneyText(s.faturamento))}
        ${kpi("Lucro bruto", moneyText(s.lucro))}
      </div>

      <h3>Viagens a este fornecedor</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Km</th><th>Peças da viagem</th><th>Custo da viagem</th><th>Outras lojas</th></tr></thead>
          <tbody>${viagens}</tbody>
        </table>
      </div>

      <h3>Peças compradas</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Código</th><th>Peça</th><th>Comprada</th><th>No estoque</th><th>Custo unit.</th><th>Venda</th></tr></thead>
          <tbody>${pecas}</tbody>
        </table>
      </div>
      <p class="muted small">Valor em produtos = quantidade comprada × custo do produto, sem o transporte da viagem.</p>`;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nome = form.elements.nome.value.trim();
    if (!nome) {
      message.textContent = "Informe o nome do fornecedor.";
      return;
    }
    const repetido = cache.fornecedores.find((f) => f.nome.toLowerCase() === nome.toLowerCase() && f.id !== editingId);
    if (repetido) {
      message.textContent = `Já existe um fornecedor chamado ${repetido.nome}.`;
      return;
    }
    const dados = {
      nome,
      cidade: form.elements.cidade.value.trim() || null,
      telefone: form.elements.telefone.value.trim() || null,
      contato: form.elements.contato.value.trim() || null,
      site: form.elements.site.value.trim() || null,
      endereco: form.elements.endereco.value.trim() || null,
      categorias: form.elements.categorias.value.trim() || null,
      obs: form.elements.obs.value.trim() || null,
    };
    const { error } = editingId
      ? await db.from("fornecedores").update(dados).eq("id", editingId)
      : await db.from("fornecedores").insert(dados);
    if (error) {
      message.textContent = friendlyError(error);
      return;
    }
    message.textContent = editingId ? "Fornecedor atualizado." : "Fornecedor salvo.";
    setEditing(null);
    await refreshAll();
  });

  cancelButton.addEventListener("click", () => {
    setEditing(null);
    message.textContent = "";
  });

  search.addEventListener("input", renderList);

  list.addEventListener("click", (event) => {
    const id = event.target.dataset.open;
    if (!id) return;
    selectedId = id;
    renderDetail();
    detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  detail.addEventListener("click", (event) => {
    if (event.target.dataset.close) {
      selectedId = null;
      renderDetail();
    }
    if (event.target.dataset.edit) {
      setEditing(event.target.dataset.edit);
      form.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  // Excluir: as peças continuam no estoque (só perdem o fornecedor) e o fornecedor sai das viagens.
  detail.addEventListener("click", async (event) => {
    const id = event.target.dataset.delete;
    if (!id) return;
    const f = cache.fornecedores.find((x) => x.id === id);
    if (!f) return;
    const s = supplierStats(f);
    const aviso = [
      `Excluir o fornecedor ${f.nome}?`,
      s.pecas.length ? `${s.pecas.length} peça(s) do estoque ficarão sem fornecedor.` : "",
      s.viagens.length ? `Ele sai de ${s.viagens.length} viagem(ns) registrada(s).` : "",
      "Isso não pode ser desfeito.",
    ].filter(Boolean).join("\n");
    if (!window.confirm(aviso)) return;

    // Limpa também o nome antigo digitado em texto, para a peça não continuar mostrando o fornecedor excluído.
    const limpar = await db.from("estoque").update({ fornecedor: null }).eq("fornecedor_id", id);
    if (limpar.error) {
      message.textContent = friendlyError(limpar.error);
      return;
    }
    const { error } = await db.from("fornecedores").delete().eq("id", id);
    if (error) {
      message.textContent = friendlyError(error);
      return;
    }
    if (editingId === id) setEditing(null);
    selectedId = null;
    message.textContent = `Fornecedor ${f.nome} excluído.`;
    await refreshAll();
  });

  renderers.push(renderList);
  renderers.push(renderDetail);
}

// ---------- Vendas ----------

function initVendas() {
  const form = document.getElementById("sale-form");
  if (!form) return;

  const itemsBox = document.getElementById("sale-items");
  const totalEl = document.getElementById("sale-total");
  const message = document.getElementById("sale-message");
  const list = document.getElementById("sale-list");
  const clienteSelect = form.elements.cliente;
  const parcelasLabel = document.getElementById("sale-parcelas-label");
  const parcelasSelect = form.elements.parcelas;
  const isCredit = () => form.elements.forma.value === "Cartão de crédito";

  // Opções de 1x a 12x, já mostrando o valor de cada parcela. Só aparece no cartão de crédito.
  function renderParcelas(total) {
    parcelasLabel.hidden = !isCredit();
    const current = parcelasSelect.value || "1";
    parcelasSelect.innerHTML = Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      return `<option value="${n}">${n}x${total > 0 ? ` de ${moneyText(total / n)}` : ""}</option>`;
    }).join("");
    parcelasSelect.value = current;
  }

  form.elements.data.value = todayBR();
  maskDateBR(form.elements.data);
  form.elements.forma.innerHTML = FORMAS_PAGAMENTO.map((f) => `<option>${f}</option>`).join("");

  function optionsEstoque(selected) {
    const options = cache.estoque
      .filter((p) => p.quantidade > 0)
      .map((p) => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${p.codigo ? `[${escapeHtml(p.codigo)}] ` : ""}${escapeHtml(p.nome)}${p.tamanho ? ` · ${escapeHtml(p.tamanho)}` : ""} (${p.quantidade} un.)</option>`)
      .join("");
    return `<option value="">Escolha a peça</option>${options}`;
  }

  function addItemRow() {
    const row = document.createElement("div");
    row.className = "sale-item";
    row.innerHTML = `
      <select data-field="estoque">${optionsEstoque("")}</select>
      <input type="number" data-field="quantidade" min="1" step="1" value="1" aria-label="Quantidade">
      <input type="number" data-field="preco" min="0" step="0.01" placeholder="Preço" aria-label="Preço unitário">
      <button type="button" class="link-btn" data-field="remover">Remover</button>`;
    itemsBox.appendChild(row);
  }

  function readItems() {
    return [...itemsBox.querySelectorAll(".sale-item")].map((row) => ({
      estoque_id: row.querySelector('[data-field="estoque"]').value,
      quantidade: num(row.querySelector('[data-field="quantidade"]').value),
      preco: num(row.querySelector('[data-field="preco"]').value),
    }));
  }

  function renderTotal() {
    const total = readItems().reduce((sum, i) => sum + i.quantidade * i.preco, 0);
    totalEl.textContent = brl.format(total);
    renderParcelas(total);
  }

  function renderVendas() {
    const currentCliente = clienteSelect.value;
    const clientes = cache.clientes
      .slice()
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      .map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`)
      .join("");
    clienteSelect.innerHTML = `<option value="">Sem cadastro (venda avulsa)</option>${clientes}`;
    clienteSelect.value = currentCliente;

    if (itemsBox.children.length === 0) addItemRow();
    itemsBox.querySelectorAll('[data-field="estoque"]').forEach((select) => {
      select.innerHTML = optionsEstoque(select.value);
    });
    renderTotal();

    if (cache.vendas.length === 0) {
      list.innerHTML = '<p class="muted">Nenhuma venda registrada ainda.</p>';
      return;
    }
    const rows = cache.vendas
      .map((v) => {
        const cliente = cache.clientes.find((c) => c.id === v.clienteId);
        const pecas = v.itens.reduce((sum, i) => sum + i.quantidade, 0);
        const action = v.estornada
          ? '<span class="muted small">Desfeita</span>'
          : `<button class="link-btn" data-estornar="${v.id}" type="button">Desfazer</button>`;
        return `
          <tr class="${v.estornada ? "undone" : ""}">
            <td>${formatDate(v.data)}</td>
            <td>${cliente ? escapeHtml(cliente.nome) : "—"}</td>
            <td>${escapeHtml(formaVenda(v) || "—")}</td>
            <td>${pecas} peça(s)</td>
            <td><strong>${brl.format(v.total)}</strong></td>
            <td>${action}</td>
          </tr>`;
      })
      .join("");
    list.innerHTML = `
      <table>
        <thead><tr><th>Data</th><th>Cliente</th><th>Pagamento</th><th>Itens</th><th>Total</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  list.addEventListener("click", async (event) => {
    const id = event.target.dataset.estornar;
    if (!id) return;
    if (!window.confirm("Desfazer esta venda? As peças voltam ao estoque e o valor é estornado no caixa.")) return;
    const { error } = await db.rpc("estornar_venda", { p_venda_id: id, p_data: todayISO() });
    if (error) {
      message.textContent = `Não foi possível desfazer a venda. ${error.message}`;
      return;
    }
    message.textContent = "Venda desfeita.";
    await refreshAll();
  });

  document.getElementById("sale-add-item").addEventListener("click", () => {
    addItemRow();
    renderTotal();
  });

  itemsBox.addEventListener("change", (event) => {
    if (event.target.dataset.field !== "estoque") return;
    const peca = cache.estoque.find((p) => p.id === event.target.value);
    const row = event.target.closest(".sale-item");
    const precoInput = row.querySelector('[data-field="preco"]');
    if (peca && !precoInput.value) precoInput.value = peca.precoVenda.toFixed(2);
    renderTotal();
  });

  itemsBox.addEventListener("input", renderTotal);
  form.elements.forma.addEventListener("change", renderTotal);

  itemsBox.addEventListener("click", (event) => {
    if (event.target.dataset.field !== "remover") return;
    event.target.closest(".sale-item").remove();
    renderTotal();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const dataIso = parseDateBR(form.elements.data.value);
    const itens = readItems();
    if (!dataIso) {
      message.textContent = "Confira a data (DD/MM/AAAA).";
      return;
    }
    if (itens.length === 0 || itens.some((i) => !i.estoque_id || !(i.quantidade > 0) || !(i.preco >= 0))) {
      message.textContent = "Confira peça, quantidade e preço de cada item.";
      return;
    }
    const total = itens.reduce((sum, i) => sum + i.quantidade * i.preco, 0);
    if (!(total > 0)) {
      message.textContent = "O total da venda precisa ser maior que zero.";
      return;
    }
    message.textContent = "Registrando...";
    const { error } = await db.rpc("registrar_venda", {
      p_data: dataIso,
      p_cliente_id: clienteSelect.value || null,
      p_forma: form.elements.forma.value,
      p_obs: form.elements.obs.value.trim(),
      p_itens: itens,
      p_parcelas: isCredit() ? Number(parcelasSelect.value) : 1,
    });
    if (error) {
      message.textContent = `Não foi possível registrar a venda. ${error.message}`;
      return;
    }
    message.textContent = "Venda registrada.";
    form.elements.obs.value = "";
    parcelasSelect.value = "1";
    itemsBox.innerHTML = "";
    await refreshAll();
  });

  renderers.push(renderVendas);
}

// ---------- Financeiro ----------

const FORMAS_PAGAMENTO = ["Dinheiro", "Pix", "Cartão de débito", "Cartão de crédito", "Transferência", "Outro"];
const CATEGORIAS = {
  saida: ["Compra de peças", "Transporte (viagem)", "Energia", "Cápsulas", "Embalagens", "Marketing", "Aluguel", "Outras saídas"],
  entrada: ["Venda", "Outras entradas"],
};

const monthKey = (iso) => iso.slice(0, 7);
const monthLabel = (key) => key.split("-").reverse().join("/");

function shiftMonth(key, delta) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function sumByTipo(list, tipo) {
  return list.filter((l) => l.tipo === tipo).reduce((sum, l) => sum + l.valor, 0);
}

function initFinance() {
  const form = document.getElementById("finance-form");
  if (!form) return;

  const monthInput = document.getElementById("finance-month");
  const message = document.getElementById("finance-message");
  const chart = document.getElementById("finance-chart");
  const compare = document.getElementById("finance-compare");
  const list = document.getElementById("finance-list");

  monthInput.value = monthKey(todayISO());
  form.elements.data.value = todayBR();
  maskDateBR(form.elements.data);
  form.elements.forma.innerHTML = FORMAS_PAGAMENTO.map((f) => `<option>${f}</option>`).join("");

  function fillCategorias() {
    form.elements.categoria.innerHTML = CATEGORIAS[form.elements.tipo.value]
      .map((c) => `<option>${c}</option>`)
      .join("");
  }
  form.elements.tipo.addEventListener("change", fillCategorias);
  fillCategorias();

  function setKpi(id, value, negative = false) {
    const el = document.getElementById(id);
    el.textContent = brl.format(value);
    el.classList.toggle("neg", negative);
  }

  function renderFinance() {
    const key = monthInput.value || monthKey(todayISO());
    const all = cache.lancamentos;

    const saldoTotal = sumByTipo(all, "entrada") - sumByTipo(all, "saida");
    const doMes = all.filter((l) => monthKey(l.data) === key);
    const entradas = sumByTipo(doMes, "entrada");
    const saidas = sumByTipo(doMes, "saida");
    setKpi("kpi-saldo", saldoTotal, saldoTotal < 0);
    setKpi("kpi-entradas", entradas);
    setKpi("kpi-saidas", saidas);
    setKpi("kpi-resultado", entradas - saidas, entradas - saidas < 0);

    const months = [-5, -4, -3, -2, -1, 0].map((d) => shiftMonth(key, d));
    const series = months.map((m) => {
      const ls = all.filter((l) => monthKey(l.data) === m);
      return { m, e: sumByTipo(ls, "entrada"), s: sumByTipo(ls, "saida") };
    });
    const max = Math.max(1, ...series.flatMap((d) => [d.e, d.s]));

    chart.innerHTML = series
      .map((d) => `
        <div class="bar-group">
          <div class="bars">
            <div class="bar in" style="height:${((d.e / max) * 100).toFixed(1)}%" title="Entradas ${brl.format(d.e)}"></div>
            <div class="bar out" style="height:${((d.s / max) * 100).toFixed(1)}%" title="Saídas ${brl.format(d.s)}"></div>
          </div>
          <span class="small muted">${monthLabel(d.m)}</span>
        </div>`)
      .join("");

    const rows = series
      .map((d) => `
        <tr>
          <td>${monthLabel(d.m)}</td>
          <td>${brl.format(d.e)}</td>
          <td>${brl.format(d.s)}</td>
          <td><strong>${brl.format(d.e - d.s)}</strong></td>
        </tr>`)
      .join("");
    compare.innerHTML = `
      <table>
        <thead><tr><th>Mês</th><th>Entradas</th><th>Saídas</th><th>Resultado</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    if (doMes.length === 0) {
      list.innerHTML = '<p class="muted">Nenhum lançamento neste mês.</p>';
      return;
    }
    const lines = doMes
      .slice()
      .sort((a, b) => (a.data < b.data ? 1 : -1))
      .map((l) => `
        <tr>
          <td>${formatDate(l.data)}</td>
          <td class="${l.tipo === "entrada" ? "tag-in" : "tag-out"}">${l.tipo === "entrada" ? "Entrada" : "Saída"}</td>
          <td>${escapeHtml(l.categoria)}</td>
          <td>${escapeHtml(l.descricao || "—")}</td>
          <td>${escapeHtml(l.forma || "—")}</td>
          <td>${brl.format(l.valor)}</td>
          <td><button class="link-btn" data-remove="${l.id}" type="button">Remover</button></td>
        </tr>`)
      .join("");
    list.innerHTML = `
      <table>
        <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Pagamento</th><th>Valor</th><th></th></tr></thead>
        <tbody>${lines}</tbody>
      </table>`;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const dataIso = parseDateBR(form.elements.data.value);
    const valor = num(form.elements.valor.value);
    if (!dataIso || !(valor > 0)) {
      message.textContent = "Confira a data (DD/MM/AAAA) e o valor.";
      return;
    }
    const { error } = await db.from("lancamentos").insert({
      data: dataIso,
      tipo: form.elements.tipo.value,
      categoria: form.elements.categoria.value,
      descricao: form.elements.descricao.value.trim() || null,
      valor,
      forma_pagamento: form.elements.forma.value,
    });
    if (error) {
      message.textContent = friendlyError(error);
      return;
    }
    message.textContent = "Lançamento salvo.";
    form.elements.valor.value = "";
    form.elements.descricao.value = "";
    monthInput.value = monthKey(dataIso);
    await refreshAll();
  });

  list.addEventListener("click", async (event) => {
    const id = event.target.dataset.remove;
    if (!id) return;
    if (!window.confirm("Remover este lançamento?")) return;
    const { error } = await db.from("lancamentos").delete().eq("id", id);
    if (error) {
      message.textContent = friendlyError(error);
      return;
    }
    await refreshAll();
  });

  monthInput.addEventListener("change", renderFinance);
  renderers.push(renderFinance);
}

// ---------- Exportar (backup em planilha) ----------

// Número no formato brasileiro (vírgula decimal), para abrir certo no Excel.
const csvNumber = (value) => String(Number(value)).replace(".", ",");

// Células de texto que começariam com = + - @ ganham um apóstrofo, para o Excel não tratá-las como fórmula.
function csvCell(value) {
  const text = String(value ?? "");
  const looksLikeNumber = /^-?\d+([.,]\d+)?$/.test(text);
  const safe = /^[=+\-@]/.test(text) && !looksLikeNumber ? `'${text}` : text;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function downloadCsv(name, headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(";"));
  const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `majen-${name}-${todayISO()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const EXPORTS = {
  clientes: () =>
    downloadCsv(
      "clientes",
      ["Nome", "WhatsApp", "Aniversário", "Origem", "Indicada por", "Tamanho", "Perfume", "Estilo", "Aceita WhatsApp", "Aceita promoções", "Compras", "Total gasto", "Última compra", "Observações"],
      cache.clientes.map((c) => [
        c.nome, c.whatsapp, formatDate(c.aniversario), c.origem, c.indicadaPor, c.tamanho, c.perfume, c.estilo,
        c.consentWhats ? "Sim" : "Não", c.consentPromo ? "Sim" : "Não",
        c.compras.length, csvNumber(totalSpent(c)), formatDate(lastPurchase(c)), c.obs,
      ])
    ),
  vendas: () =>
    downloadCsv(
      "vendas",
      ["Data", "Cliente", "Pagamento", "Peças", "Total", "Status"],
      cache.vendas.map((v) => {
        const cliente = cache.clientes.find((c) => c.id === v.clienteId);
        return [
          formatDate(v.data), cliente ? cliente.nome : "", formaVenda(v),
          v.itens.reduce((sum, i) => sum + i.quantidade, 0), csvNumber(v.total), v.estornada ? "Desfeita" : "Ativa",
        ];
      })
    ),
  financeiro: () =>
    downloadCsv(
      "financeiro",
      ["Data", "Tipo", "Categoria", "Descrição", "Pagamento", "Valor"],
      cache.lancamentos.map((l) => [
        formatDate(l.data), l.tipo === "entrada" ? "Entrada" : "Saída", l.categoria, l.descricao, l.forma, csvNumber(l.valor),
      ])
    ),
  estoque: () =>
    downloadCsv(
      "estoque",
      ["Código", "Nome", "Fornecedor", "Categoria", "Tamanho", "Cor", "Quantidade", "Custo do produto", "Custo de transporte", "Custo total", "Preço de venda"],
      cache.estoque.map((p) => [
        p.codigo, p.nome, fornecedorDe(p), p.categoria, p.tamanho, p.cor, p.quantidade,
        csvNumber(p.custoProduto), csvNumber(p.custoTransporte), csvNumber(p.custoTotal), csvNumber(p.precoVenda),
      ])
    ),
  fornecedores: () =>
    downloadCsv(
      "fornecedores",
      ["Fornecedor", "Cidade", "Telefone", "Contato", "Site ou Instagram", "O que vendem", "Viagens", "Peças compradas", "Valor comprado", "Em estoque", "Peças vendidas", "Faturamento", "Lucro bruto"],
      cache.fornecedores.map((f) => {
        const s = supplierStats(f);
        return [
          f.nome, f.cidade, f.telefone, f.contato, f.site, f.categorias, s.viagens.length,
          s.comprado, csvNumber(s.valorComprado), s.emEstoque, s.vendidas, csvNumber(s.faturamento), csvNumber(s.lucro),
        ];
      })
    ),
  viagens: () =>
    downloadCsv(
      "viagens",
      ["Data", "Km", "Consumo (km/L)", "Combustível", "Preço por litro", "Pedágio", "Peças", "Custo da viagem", "Custo por peça"],
      cache.viagens.map((t) => [
        formatDate(t.data), t.km, csvNumber(t.consumo), t.tipoCombustivel, csvNumber(t.preco),
        csvNumber(t.pedagio), t.pecas, csvNumber(t.total), csvNumber(t.porPeca),
      ])
    ),
};

// ---------- Relatórios (Excel e PDF) ----------

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const moneyText = (n) => brl.format(n).replace(/ /g, " ");
const periodLabel = (r) => `${r.from ? formatDate(r.from) : "início"} a ${r.to ? formatDate(r.to) : "hoje"}`;

// Reúne os números do período. from/to em AAAA-MM-DD; vazio = sem limite.
// Vendas desfeitas aparecem nas listas (com status), mas não entram nos totais de vendas.
function buildReport(from, to) {
  const inRange = (iso) => (!from || iso >= from) && (!to || iso <= to);
  const byDate = (a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0);
  const nomeCliente = (id) => {
    const c = cache.clientes.find((x) => x.id === id);
    return c ? c.nome : "Venda avulsa";
  };

  const vendas = cache.vendas.filter((v) => inRange(v.data)).sort(byDate);
  const ativas = vendas.filter((v) => !v.estornada);

  const itens = [];
  vendas.forEach((v) => {
    v.itens.forEach((i) => {
      const peca = cache.estoque.find((x) => x.id === i.estoqueId);
      itens.push({
        cliente: nomeCliente(v.clienteId),
        data: v.data,
        peca: peca ? peca.nome : "(peça removida)",
        codigo: peca ? peca.codigo : "",
        tamanho: peca ? peca.tamanho : "",
        cor: peca ? peca.cor : "",
        quantidade: i.quantidade,
        preco: i.preco,
        custo: i.custo,
        subtotal: i.quantidade * i.preco,
        pagamento: formaVenda(v),
        status: v.estornada ? "Desfeita" : "Ativa",
      });
    });
  });
  itens.sort((a, b) => a.cliente.localeCompare(b.cliente, "pt-BR") || byDate(a, b));

  const itensAtivos = itens.filter((i) => i.status === "Ativa");
  const faturamento = ativas.reduce((sum, v) => sum + v.total, 0);
  const pecas = itensAtivos.reduce((sum, i) => sum + i.quantidade, 0);
  const custo = itensAtivos.reduce((sum, i) => sum + i.quantidade * i.custo, 0);
  const lucro = faturamento - custo;

  const lancamentos = cache.lancamentos.filter((l) => inRange(l.data)).sort(byDate);
  const entradas = sumByTipo(lancamentos, "entrada");
  const saidas = sumByTipo(lancamentos, "saida");

  const agrupar = (list, chave, valor) => {
    const mapa = new Map();
    list.forEach((x) => mapa.set(chave(x), (mapa.get(chave(x)) || 0) + valor(x)));
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  };
  const porForma = agrupar(ativas, (v) => v.forma || "Não informado", (v) => v.total);
  const saidasPorCategoria = agrupar(lancamentos.filter((l) => l.tipo === "saida"), (l) => l.categoria, (l) => l.valor);

  const clientes = cache.clientes
    .map((cliente) => {
      const minhas = ativas.filter((v) => v.clienteId === cliente.id);
      return {
        cliente,
        vendas: minhas.length,
        pecas: minhas.reduce((sum, v) => sum + v.itens.reduce((acc, i) => acc + i.quantidade, 0), 0),
        totalPeriodo: minhas.reduce((sum, v) => sum + v.total, 0),
      };
    })
    .sort((a, b) => b.totalPeriodo - a.totalPeriodo || a.cliente.nome.localeCompare(b.cliente.nome, "pt-BR"));

  // Fornecedores: compras (peças que entraram no estoque no período) e vendas do período dessas peças.
  const pecasPeriodo = cache.estoque.filter((p) => !p.criadoEm || inRange(p.criadoEm));
  const nomeFornecedor = (p) => fornecedorDe(p) || "Sem fornecedor";
  const grupos = new Map();
  const grupo = (nome) => {
    if (!grupos.has(nome)) {
      grupos.set(nome, { nome, fornecedor: null, viagens: 0, comprado: 0, valorComprado: 0, emEstoque: 0, vendidas: 0, faturamento: 0, lucro: 0 });
    }
    return grupos.get(nome);
  };
  cache.fornecedores.forEach((f) => {
    const g = grupo(f.nome);
    g.fornecedor = f;
    g.viagens = cache.viagens.filter((t) => inRange(t.data) && t.fornecedorIds.includes(f.id)).length;
  });
  pecasPeriodo.forEach((p) => {
    const g = grupo(nomeFornecedor(p));
    g.comprado += p.quantidadeInicial;
    g.valorComprado += p.quantidadeInicial * p.custoProduto;
  });
  cache.estoque.forEach((p) => {
    grupo(nomeFornecedor(p)).emEstoque += p.quantidade;
  });
  const donoDaPeca = new Map(cache.estoque.map((p) => [p.id, nomeFornecedor(p)]));
  ativas.forEach((v) =>
    v.itens.forEach((i) => {
      const g = grupo(donoDaPeca.get(i.estoqueId) || "Sem fornecedor");
      g.vendidas += i.quantidade;
      g.faturamento += i.quantidade * i.preco;
      g.lucro += i.quantidade * (i.preco - i.custo);
    })
  );
  const fornecedores = [...grupos.values()]
    .filter((g) => g.fornecedor || g.comprado || g.vendidas || g.emEstoque)
    .sort((a, b) => b.valorComprado - a.valorComprado || a.nome.localeCompare(b.nome, "pt-BR"));
  const comprasFornecedor = pecasPeriodo
    .map((p) => ({
      fornecedor: nomeFornecedor(p),
      data: p.criadoEm,
      codigo: p.codigo,
      peca: p.nome,
      tamanho: p.tamanho,
      cor: p.cor,
      comprada: p.quantidadeInicial,
      custo: p.custoProduto,
      valor: p.quantidadeInicial * p.custoProduto,
      emEstoque: p.quantidade,
    }))
    .sort((a, b) => a.fornecedor.localeCompare(b.fornecedor, "pt-BR") || a.peca.localeCompare(b.peca, "pt-BR"));

  return {
    from, to, vendas, ativas, itens, lancamentos, clientes, porForma, saidasPorCategoria, nomeCliente,
    fornecedores, comprasFornecedor,
    totais: {
      faturamento, pecas, custo, lucro,
      ticket: ativas.length ? faturamento / ativas.length : 0,
      margem: faturamento ? lucro / faturamento : 0,
      entradas, saidas, resultado: entradas - saidas,
    },
  };
}

// Linhas do resumo, usadas no Excel e no PDF.
function summaryRows(r) {
  const t = r.totais;
  const rows = [
    { section: "Vendas" },
    { label: "Número de vendas", value: r.ativas.length, type: "int" },
    { label: "Peças vendidas", value: t.pecas, type: "int" },
    { label: "Faturamento", value: t.faturamento, type: "money" },
    { label: "Ticket médio", value: t.ticket, type: "money" },
    { label: "Custo das peças vendidas", value: t.custo, type: "money" },
    { label: "Lucro bruto", value: t.lucro, type: "money" },
    { label: "Margem bruta", value: t.margem, type: "pct" },
    { section: "Financeiro (caixa)" },
    { label: "Entradas", value: t.entradas, type: "money" },
    { label: "Saídas", value: t.saidas, type: "money" },
    { label: "Resultado", value: t.resultado, type: "money" },
    { section: "Vendas por forma de pagamento" },
  ];
  if (r.porForma.length === 0) rows.push({ label: "Sem vendas no período", value: "", type: "text" });
  r.porForma.forEach(([forma, valor]) => rows.push({ label: forma, value: valor, type: "money" }));
  rows.push({ section: "Saídas por categoria" });
  if (r.saidasPorCategoria.length === 0) rows.push({ label: "Sem saídas no período", value: "", type: "text" });
  r.saidasPorCategoria.forEach(([cat, valor]) => rows.push({ label: cat, value: valor, type: "money" }));
  rows.push({ section: "Compras por fornecedor (valor em produtos)" });
  const comprasPorFornecedor = r.fornecedores.filter((g) => g.valorComprado > 0);
  if (comprasPorFornecedor.length === 0) rows.push({ label: "Sem compras no período", value: "", type: "text" });
  comprasPorFornecedor.forEach((g) => rows.push({ label: g.nome, value: g.valorComprado, type: "money" }));
  return rows;
}

function exportExcel(r) {
  if (!window.XLSX) throw new Error("A biblioteca de Excel não carregou. Verifique a internet.");
  const wb = XLSX.utils.book_new();
  const MONEY = '"R$" #,##0.00';

  const addSheet = (name, aoa, widths, moneyCols = []) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = widths.map((wch) => ({ wch }));
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let row = 1; row <= range.e.r; row++) {
      moneyCols.forEach((col) => {
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell && cell.t === "n") cell.z = MONEY;
      });
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  const resumo = [["MAJEN - Resumo de vendas e financeiro"], ["Período", periodLabel(r)], ["Gerado em", todayBR()], []];
  const tipos = {};
  summaryRows(r).forEach((row) => {
    if (row.section) {
      resumo.push([], [row.section.toUpperCase()]);
      return;
    }
    tipos[resumo.length] = row.type;
    resumo.push([row.label, row.value]);
  });
  const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
  wsResumo["!cols"] = [{ wch: 34 }, { wch: 20 }];
  Object.entries(tipos).forEach(([rowIndex, type]) => {
    const cell = wsResumo[XLSX.utils.encode_cell({ r: Number(rowIndex), c: 1 })];
    if (!cell || cell.t !== "n") return;
    cell.z = type === "money" ? MONEY : type === "pct" ? "0.0%" : "0";
  });
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  addSheet(
    "Vendas",
    [["Data", "Cliente", "Pagamento", "Peças", "Total", "Status"]].concat(
      r.vendas.map((v) => [
        formatDate(v.data), r.nomeCliente(v.clienteId), formaVenda(v),
        v.itens.reduce((sum, i) => sum + i.quantidade, 0), v.total, v.estornada ? "Desfeita" : "Ativa",
      ])
    ),
    [12, 28, 18, 8, 14, 10],
    [4]
  );

  addSheet(
    "Compras por cliente",
    [["Cliente", "Data", "Peça", "Código", "Tamanho", "Cor", "Quantidade", "Valor unitário", "Subtotal", "Pagamento", "Status"]].concat(
      r.itens.map((i) => [i.cliente, formatDate(i.data), i.peca, i.codigo, i.tamanho, i.cor, i.quantidade, i.preco, i.subtotal, i.pagamento, i.status])
    ),
    [28, 12, 30, 14, 10, 12, 12, 16, 14, 18, 10],
    [7, 8]
  );

  addSheet(
    "Clientes",
    [["Nome", "WhatsApp", "Aniversário", "Origem", "Tamanho habitual", "Perfume", "Estilo", "Aceita WhatsApp", "Aceita promoções", "Compras no período", "Peças no período", "Total no período", "Total geral gasto", "Última compra"]].concat(
      r.clientes.map(({ cliente: c, vendas, pecas, totalPeriodo }) => [
        c.nome, c.whatsapp, formatDate(c.aniversario), c.origem, c.tamanho, c.perfume, c.estilo,
        c.consentWhats ? "Sim" : "Não", c.consentPromo ? "Sim" : "Não",
        vendas, pecas, totalPeriodo, totalSpent(c), formatDate(lastPurchase(c)),
      ])
    ),
    [28, 16, 12, 16, 16, 16, 20, 16, 16, 18, 16, 16, 16, 14],
    [11, 12]
  );

  addSheet(
    "Fornecedores",
    [["Fornecedor", "Cidade", "Telefone", "Viagens no período", "Peças compradas", "Valor comprado", "Em estoque agora", "Peças vendidas", "Faturamento", "Lucro bruto"]].concat(
      r.fornecedores.map((g) => [
        g.nome, g.fornecedor ? g.fornecedor.cidade : "", g.fornecedor ? g.fornecedor.telefone : "",
        g.viagens, g.comprado, g.valorComprado, g.emEstoque, g.vendidas, g.faturamento, g.lucro,
      ])
    ),
    [28, 16, 16, 18, 16, 16, 16, 14, 14, 14],
    [5, 8, 9]
  );

  addSheet(
    "Compras por fornecedor",
    [["Fornecedor", "Data", "Código", "Peça", "Tamanho", "Cor", "Quantidade comprada", "Custo unitário", "Valor comprado", "No estoque agora"]].concat(
      r.comprasFornecedor.map((c) => [c.fornecedor, formatDate(c.data), c.codigo, c.peca, c.tamanho, c.cor, c.comprada, c.custo, c.valor, c.emEstoque])
    ),
    [28, 12, 14, 30, 10, 12, 18, 14, 16, 16],
    [7, 8]
  );

  addSheet(
    "Financeiro",
    [["Data", "Tipo", "Categoria", "Descrição", "Pagamento", "Valor"]].concat(
      r.lancamentos.map((l) => [formatDate(l.data), l.tipo === "entrada" ? "Entrada" : "Saída", l.categoria, l.descricao, l.forma, l.valor])
    ),
    [12, 10, 24, 40, 18, 14],
    [5]
  );

  XLSX.writeFile(wb, `majen-relatorio-${todayISO()}.xlsx`);
}

function exportPdf(r) {
  if (!window.jspdf) throw new Error("A biblioteca de PDF não carregou. Verifique a internet.");
  const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const ROSE = [135, 87, 101];
  const BLUSH = [241, 221, 225];
  const PAPER = [251, 245, 239];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...ROSE);
  doc.text("MAJEN", 40, 46);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(74, 58, 64);
  doc.text("Relatório de vendas e financeiro", 40, 64);
  doc.text(`Período: ${periodLabel(r)}   ·   Gerado em ${todayBR()}`, 40, 80);

  let y = 106;
  const section = (title, head, body, columnStyles = {}) => {
    if (y > pageHeight - 120) {
      doc.addPage();
      y = 40;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...ROSE);
    doc.text(title, 40, y);
    doc.autoTable({
      startY: y + 8,
      head: [head],
      body: body.length ? body : [["Sem registros no período"]],
      theme: "striped",
      headStyles: { fillColor: ROSE, textColor: 255 },
      alternateRowStyles: { fillColor: PAPER },
      styles: { fontSize: 9, cellPadding: 4, textColor: [74, 58, 64] },
      columnStyles,
      margin: { left: 40, right: 40 },
    });
    y = doc.lastAutoTable.finalY + 28;
  };

  const formatValue = (row) => {
    if (row.type === "money") return moneyText(row.value);
    if (row.type === "pct") return `${(row.value * 100).toFixed(1).replace(".", ",")}%`;
    return String(row.value);
  };
  const resumoBody = summaryRows(r).map((row) =>
    row.section
      ? [{ content: row.section, colSpan: 2, styles: { fillColor: BLUSH, textColor: ROSE, fontStyle: "bold" } }]
      : [row.label, formatValue(row)]
  );
  section("Resumo", ["Indicador", "Valor"], resumoBody, { 1: { halign: "right" } });

  section(
    "Compras por cliente (quem comprou o quê)",
    ["Cliente", "Data", "Peça", "Cód.", "Tam.", "Cor", "Qtd", "Valor unit.", "Subtotal", "Status"],
    r.itens.map((i) => [i.cliente, formatDate(i.data), i.peca, i.codigo || "—", i.tamanho, i.cor, String(i.quantidade), moneyText(i.preco), moneyText(i.subtotal), i.status]),
    { 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } }
  );

  section(
    "Vendas",
    ["Data", "Cliente", "Pagamento", "Peças", "Total", "Status"],
    r.vendas.map((v) => [
      formatDate(v.data), r.nomeCliente(v.clienteId), formaVenda(v) || "—",
      String(v.itens.reduce((sum, i) => sum + i.quantidade, 0)), moneyText(v.total), v.estornada ? "Desfeita" : "Ativa",
    ]),
    { 3: { halign: "right" }, 4: { halign: "right" } }
  );

  section(
    "Fornecedores",
    ["Fornecedor", "Cidade", "Viagens", "Peças compradas", "Valor comprado", "No estoque", "Vendidas", "Faturamento", "Lucro bruto"],
    r.fornecedores.map((g) => [
      g.nome, g.fornecedor ? g.fornecedor.cidade || "—" : "—", String(g.viagens), String(g.comprado), moneyText(g.valorComprado),
      String(g.emEstoque), String(g.vendidas), moneyText(g.faturamento), moneyText(g.lucro),
    ]),
    { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } }
  );

  section(
    "Compras por fornecedor (peças)",
    ["Fornecedor", "Data", "Cód.", "Peça", "Tam.", "Cor", "Qtd comprada", "Custo unit.", "Valor", "No estoque"],
    r.comprasFornecedor.map((c) => [
      c.fornecedor, formatDate(c.data), c.codigo || "—", c.peca, c.tamanho, c.cor, String(c.comprada), moneyText(c.custo), moneyText(c.valor), String(c.emEstoque),
    ]),
    { 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" } }
  );

  section(
    "Financeiro (entradas e saídas)",
    ["Data", "Tipo", "Categoria", "Descrição", "Pagamento", "Valor"],
    r.lancamentos.map((l) => [
      formatDate(l.data), l.tipo === "entrada" ? "Entrada" : "Saída", l.categoria, l.descricao || "—", l.forma || "—", moneyText(l.valor),
    ]),
    { 5: { halign: "right" } }
  );

  section(
    "Clientes",
    ["Cliente", "WhatsApp", "Aniversário", "Compras", "Peças", "Total no período", "Total geral"],
    r.clientes.map(({ cliente: c, vendas, pecas, totalPeriodo }) => [
      c.nome, c.whatsapp, formatDate(c.aniversario), String(vendas), String(pecas), moneyText(totalPeriodo), moneyText(totalSpent(c)),
    ]),
    { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } }
  );

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(122, 102, 112);
    doc.text(`MAJEN · Página ${i} de ${pages}`, pageWidth - 40, pageHeight - 20, { align: "right" });
  }
  doc.save(`majen-relatorio-${todayISO()}.pdf`);
}

function initRelatorios() {
  const fromInput = document.getElementById("report-from");
  if (!fromInput) return;
  const toInput = document.getElementById("report-to");
  const message = document.getElementById("report-message");
  const preview = document.getElementById("report-preview");
  maskDateBR(fromInput);
  maskDateBR(toInput);

  function readPeriod() {
    const from = fromInput.value.trim() ? parseDateBR(fromInput.value) : "";
    const to = toInput.value.trim() ? parseDateBR(toInput.value) : "";
    if (from === null || to === null) {
      message.textContent = "Confira as datas (DD/MM/AAAA).";
      return null;
    }
    if (from && to && from > to) {
      message.textContent = "A data inicial não pode ser depois da final.";
      return null;
    }
    message.textContent = "";
    return { from, to };
  }

  function listCard(title, items, emptyText) {
    const body = items.length
      ? `<ul class="simple-list">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`
      : `<p class="muted">${emptyText}</p>`;
    return `<div class="card"><h2>${title}</h2>${body}</div>`;
  }

  function renderRelatorios() {
    const period = readPeriod();
    if (!period) return;
    const r = buildReport(period.from, period.to);
    const t = r.totais;
    const kpi = (label, value, negative = false) =>
      `<div class="card kpi"><span class="muted small">${label}</span><strong class="${negative ? "neg" : ""}">${value}</strong></div>`;

    const topClientes = r.clientes
      .filter((x) => x.totalPeriodo > 0)
      .slice(0, 5)
      .map((x) => `${escapeHtml(x.cliente.nome)} <strong>${moneyText(x.totalPeriodo)} · ${x.pecas} peça(s)</strong>`);

    const comprasFornecedores = r.fornecedores
      .filter((g) => g.valorComprado > 0)
      .slice(0, 5)
      .map((g) => `${escapeHtml(g.nome)} <strong>${moneyText(g.valorComprado)} · ${g.comprado} peça(s)</strong>`);

    preview.innerHTML = `
      <div class="kpis">
        ${kpi("Faturamento", moneyText(t.faturamento))}
        ${kpi("Lucro bruto", moneyText(t.lucro), t.lucro < 0)}
        ${kpi("Peças vendidas", String(t.pecas))}
        ${kpi("Ticket médio", moneyText(t.ticket))}
        ${kpi("Entradas (caixa)", moneyText(t.entradas))}
        ${kpi("Saídas (caixa)", moneyText(t.saidas))}
        ${kpi("Resultado (caixa)", moneyText(t.resultado), t.resultado < 0)}
      </div>
      <div class="panel-grid">
        ${listCard("Vendas por forma de pagamento", r.porForma.map(([f, v]) => `${escapeHtml(f)} <strong>${moneyText(v)}</strong>`), "Sem vendas no período.")}
        ${listCard("Saídas por categoria", r.saidasPorCategoria.map(([c, v]) => `${escapeHtml(c)} <strong>${moneyText(v)}</strong>`), "Sem saídas no período.")}
        ${listCard("Maiores clientes do período", topClientes, "Sem compras de clientes no período.")}
        ${listCard("Compras por fornecedor", comprasFornecedores, "Sem compras de fornecedores no período.")}
      </div>`;
  }

  function setPreset(kind) {
    if (kind === "tudo") {
      fromInput.value = "";
      toInput.value = "";
    } else {
      const now = new Date();
      const offset = kind === "mes-passado" ? -1 : 0;
      fromInput.value = formatDate(isoOf(new Date(now.getFullYear(), now.getMonth() + offset, 1)));
      toInput.value = formatDate(isoOf(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)));
    }
    renderRelatorios();
  }

  function generate(exporter) {
    const period = readPeriod();
    if (!period) return;
    try {
      exporter(buildReport(period.from, period.to));
      message.textContent = "Arquivo gerado.";
    } catch (error) {
      message.textContent = `Não foi possível gerar o arquivo. ${error.message || ""}`;
    }
  }

  fromInput.addEventListener("input", renderRelatorios);
  toInput.addEventListener("input", renderRelatorios);
  document.querySelector(".presets").addEventListener("click", (event) => {
    if (event.target.dataset.preset) setPreset(event.target.dataset.preset);
  });
  document.getElementById("report-xlsx").addEventListener("click", () => generate(exportExcel));
  document.getElementById("report-pdf").addEventListener("click", () => generate(exportPdf));

  renderers.push(renderRelatorios);
  setPreset("mes");
}

// ---------- Painel ----------

const LOW_STOCK_LIMIT = 2;

function initPainel() {
  const root = document.getElementById("painel-content");
  if (!root) return;

  root.addEventListener("click", (event) => {
    const kind = event.target.dataset.export;
    if (kind && EXPORTS[kind]) EXPORTS[kind]();
  });

  // Dias até o próximo aniversário (0 = hoje), ou null se não há data.
  function daysUntilBirthday(iso) {
    if (!iso) return null;
    const [, month, day] = iso.split("-").map(Number);
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let next = new Date(today.getFullYear(), month - 1, day);
    if (next < start) next = new Date(today.getFullYear() + 1, month - 1, day);
    return Math.round((next - start) / 86400000);
  }

  function listCard(title, items, emptyText) {
    const body = items.length
      ? `<ul class="simple-list">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`
      : `<p class="muted">${emptyText}</p>`;
    return `<div class="card"><h2>${title}</h2>${body}</div>`;
  }

  function renderPainel() {
    const key = monthKey(todayISO());
    const vendasAtivas = cache.vendas.filter((v) => !v.estornada);
    const vendasMes = vendasAtivas.filter((v) => monthKey(v.data) === key);
    const faturamento = vendasMes.reduce((sum, v) => sum + v.total, 0);
    const lucro = vendasMes.reduce(
      (sum, v) => sum + v.itens.reduce((acc, i) => acc + i.quantidade * (i.preco - i.custo), 0),
      0
    );
    const ticket = vendasMes.length ? faturamento / vendasMes.length : 0;
    const pecas = cache.estoque.reduce((sum, p) => sum + p.quantidade, 0);

    const kpi = (label, value, negative = false) =>
      `<div class="card kpi"><span class="muted small">${label}</span><strong class="${negative ? "neg" : ""}">${value}</strong></div>`;

    const baixo = cache.estoque
      .filter((p) => p.quantidade <= LOW_STOCK_LIMIT)
      .sort((a, b) => a.quantidade - b.quantidade)
      .slice(0, 8)
      .map((p) => `${escapeHtml(p.nome)}${p.tamanho ? ` · ${escapeHtml(p.tamanho)}` : ""} <strong>${p.quantidade} un.</strong>`);

    const aniversarios = cache.clientes
      .map((c) => ({ c, dias: daysUntilBirthday(c.aniversario) }))
      .filter((x) => x.dias !== null && x.dias <= 7)
      .sort((a, b) => a.dias - b.dias)
      .map(({ c, dias }) => `${escapeHtml(c.nome)} <strong>${dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `em ${dias} dias`}</strong>`);

    const ultimas = vendasAtivas.slice(0, 5).map((v) => {
      const cliente = cache.clientes.find((c) => c.id === v.clienteId);
      return `${formatDate(v.data)} · ${cliente ? escapeHtml(cliente.nome) : "venda avulsa"} <strong>${brl.format(v.total)}</strong>`;
    });

    const melhores = cache.clientes
      .map((c) => ({ c, total: totalSpent(c) }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map(({ c, total }) => `${escapeHtml(c.nome)} <strong>${brl.format(total)}</strong>`);

    root.innerHTML = `
      <div class="kpis">
        ${kpi("Faturamento do mês", brl.format(faturamento))}
        ${kpi("Lucro bruto do mês", brl.format(lucro), lucro < 0)}
        ${kpi("Ticket médio", brl.format(ticket))}
        ${kpi("Peças em estoque", String(pecas))}
      </div>
      <div class="panel-grid">
        ${listCard("Estoque baixo", baixo, "Nenhuma peça com estoque baixo.")}
        ${listCard("Aniversariantes (próximos 7 dias)", aniversarios, "Nenhum aniversário nos próximos dias.")}
        ${listCard("Últimas vendas", ultimas, "Nenhuma venda registrada ainda.")}
        ${listCard("Melhores clientes", melhores, "Ainda não há compras de clientes.")}
      </div>
      <div class="card export-card">
        <h2>Exportar dados</h2>
        <p class="muted small">Baixe uma cópia em planilha (abre no Excel). Vale fazer de vez em quando, como backup.</p>
        <div class="export-buttons">
          <button type="button" class="btn secondary" data-export="clientes">Clientes</button>
          <button type="button" class="btn secondary" data-export="vendas">Vendas</button>
          <button type="button" class="btn secondary" data-export="financeiro">Financeiro</button>
          <button type="button" class="btn secondary" data-export="estoque">Estoque</button>
          <button type="button" class="btn secondary" data-export="fornecedores">Fornecedores</button>
          <button type="button" class="btn secondary" data-export="viagens">Viagens</button>
        </div>
      </div>`;
  }

  renderers.push(renderPainel);
}

// ---------- Login ----------

function setLoggedIn(loggedIn) {
  document.getElementById("login").hidden = loggedIn;
  document.getElementById("app").hidden = !loggedIn;
}

async function startApp() {
  setLoggedIn(true);
  try {
    await refreshAll();
  } catch (error) {
    document.getElementById("login-message").textContent = `Não consegui carregar os dados. ${error.message || ""}`;
    setLoggedIn(false);
  }
}

function initAuth() {
  const loginForm = document.getElementById("login-form");
  const loginMessage = document.getElementById("login-message");

  if (!db) {
    loginMessage.textContent = "Configuração do Supabase ausente. Confira o config.js.";
    loginForm.querySelector("button").disabled = true;
    return;
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginMessage.textContent = "Entrando...";
    const { error } = await db.auth.signInWithPassword({
      email: loginForm.elements.email.value.trim(),
      password: loginForm.elements.password.value,
    });
    if (error) {
      loginMessage.textContent = "E-mail ou senha incorretos.";
      return;
    }
    loginMessage.textContent = "";
    loginForm.reset();
    await startApp();
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await db.auth.signOut();
    window.location.reload();
  });

  db.auth.getSession().then(({ data }) => {
    if (data.session) startApp();
  });
}

window.addEventListener("hashchange", showRoute);
showRoute();
initTrips();
initStock();
initClients();
initFornecedores();
initVendas();
initFinance();
initPainel();
initRelatorios();
initAuth();
