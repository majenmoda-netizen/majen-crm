// Navegação simples entre as telas, usando o hash da URL (#viagens, #estoque...).
const ROUTES = ["painel", "viagens", "estoque", "vendas", "clientes", "financeiro"];

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
const cache = { viagens: [], estoque: [], clientes: [], lancamentos: [], vendas: [] };
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
});

const stockFromRow = (r) => ({
  id: r.id,
  nome: r.nome,
  categoria: r.categoria,
  tamanho: r.tamanho || "",
  cor: r.cor || "",
  quantidade: num(r.quantidade),
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
          <tr><th>Data</th><th>Km</th><th>Combustível</th><th>Peças</th><th>Custo viagem</th><th>Por peça</th><th></th></tr>
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
    const { error } = await db.from("viagens").insert({
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
    });
    if (error) {
      message.textContent = friendlyError(error);
      return;
    }
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

  renderers.push(renderList);
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
  let photoData = "";

  function fillTrips() {
    const previous = tripSelect.value;
    const options = cache.viagens
      .map((t) => `<option value="${t.id}">${formatDate(t.data)} · ${brl.format(t.porPeca)} por peça</option>`)
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

  function renderList() {
    fillTrips();
    const items = cache.estoque;
    if (items.length === 0) {
      list.innerHTML = '<p class="muted">Nenhuma peça cadastrada ainda.</p>';
      return;
    }
    const rows = items
      .map((item) => `
        <tr>
          <td>${item.foto ? `<img class="thumb" src="${item.foto}" alt="">` : "—"}</td>
          <td>${escapeHtml(item.nome)}</td>
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
          <tr><th>Foto</th><th>Nome</th><th>Categoria</th><th>Tamanho</th><th>Cor</th><th>Qtd</th><th>Custo</th><th>Venda</th><th></th></tr>
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
  tripSelect.addEventListener("change", renderPreview);

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

// ---------- Vendas ----------

function initVendas() {
  const form = document.getElementById("sale-form");
  if (!form) return;

  const itemsBox = document.getElementById("sale-items");
  const totalEl = document.getElementById("sale-total");
  const message = document.getElementById("sale-message");
  const list = document.getElementById("sale-list");
  const clienteSelect = form.elements.cliente;

  form.elements.data.value = todayBR();
  maskDateBR(form.elements.data);
  form.elements.forma.innerHTML = FORMAS_PAGAMENTO.map((f) => `<option>${f}</option>`).join("");

  function optionsEstoque(selected) {
    const options = cache.estoque
      .filter((p) => p.quantidade > 0)
      .map((p) => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${escapeHtml(p.nome)}${p.tamanho ? ` · ${escapeHtml(p.tamanho)}` : ""} (${p.quantidade} un.)</option>`)
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
        return `
          <tr>
            <td>${formatDate(v.data)}</td>
            <td>${cliente ? escapeHtml(cliente.nome) : "—"}</td>
            <td>${escapeHtml(v.forma || "—")}</td>
            <td>${pecas} peça(s)</td>
            <td><strong>${brl.format(v.total)}</strong></td>
          </tr>`;
      })
      .join("");
    list.innerHTML = `
      <table>
        <thead><tr><th>Data</th><th>Cliente</th><th>Pagamento</th><th>Itens</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

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
    });
    if (error) {
      message.textContent = `Não foi possível registrar a venda. ${error.message}`;
      return;
    }
    message.textContent = "Venda registrada.";
    form.elements.obs.value = "";
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

// ---------- Painel ----------

const LOW_STOCK_LIMIT = 2;

function initPainel() {
  const root = document.getElementById("painel-content");
  if (!root) return;

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
    const vendasMes = cache.vendas.filter((v) => monthKey(v.data) === key);
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

    const ultimas = cache.vendas.slice(0, 5).map((v) => {
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
initVendas();
initFinance();
initPainel();
initAuth();
