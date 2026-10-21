// Navegação simples entre as telas, usando o hash da URL (#viagens, #estoque...).
const ROUTES = ["painel", "viagens", "estoque", "fornecedores", "vitrine", "vendas", "clientes", "financeiro", "relatorios"];

function showRoute() {
  const hash = window.location.hash.replace("#", "");
  // No modo cliente a tela fica travada na vitrine.
  const route = document.body.classList.contains("modo-cliente") ? "vitrine" : ROUTES.includes(hash) ? hash : "painel";

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

// Soma dias a uma data AAAA-MM-DD (usado no vencimento das vendas a prazo).
function addDaysISO(iso, dias) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + dias);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Forma de pagamento com as parcelas, quando houver (ex.: "Cartão de crédito (3x)").
const formaVenda = (v) => {
  const partes = [];
  if (v.parcelas > 1) partes.push(`${v.parcelas}x`);
  if (v.prazoDias) partes.push(`${v.prazoDias} dias`);
  if (v.taxa > 0) partes.push(`taxa ${pct(v.taxa)}`);
  return partes.length ? `${v.forma} (${partes.join(", ")})` : v.forma;
};

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
  trajeto: r.trajeto || "",
  trajetoDetalhe: r.trajeto_detalhe || null,
  fornecedorIds: [],
});

const CATEGORIAS_ESTOQUE = { roupas: "Roupas", perfumaria: "Perfumaria", chocolate: "Chocolate", outros: "Outros" };
const categoriaEstoque = (c) => CATEGORIAS_ESTOQUE[c] || c;

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
  origem: r.origem || "manual",
  refId: r.ref_id || null,
});

const vendaFromRow = (r) => ({
  id: r.id,
  data: r.data,
  clienteId: r.cliente_id,
  forma: r.forma_pagamento || "",
  total: num(r.total),
  parcelas: num(r.parcelas || 1),
  desconto: num(r.desconto_percentual || 0),
  subtotal: num(r.subtotal || r.total),
  taxa: num(r.taxa_maquininha_percentual || 0),
  taxaPagaPor: r.taxa_paga_por || "cliente",
  valorTaxa: num(r.valor_taxa || 0),
  totalCobrado: num(r.total_cobrado || r.total),
  numero: r.numero ?? null,
  obs: r.obs || "",
  prazoDias: r.prazo_dias || null,
  vencimento: r.vencimento || null,
  recebidaEm: r.recebida_em || null,
  estornada: !!r.estornada_em,
  itens: (r.itens_venda || []).map((i) => ({
    estoqueId: i.estoque_id,
    quantidade: num(i.quantidade),
    preco: num(i.preco_unitario),
    precoTabela: num(i.preco_tabela ?? i.preco_unitario),
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

  // Guarda uma cópia para abrir sem internet e depois mostra as vendas que ainda não foram enviadas.
  salvarCopiaLocal(cache);
  aplicarPendentes();
}

async function refreshAll() {
  await loadAll();
  renderers.forEach((render) => render());
}

// ---------- Vendas sem internet ----------

let modoCopia = false; // true quando a tela mostra a cópia guardada no aparelho (sem conexão com o banco)

const fila = criarFila({
  estaOnline: () => navigator.onLine && !!db,
  enviar: async (item) => {
    try {
      return await db.rpc("registrar_venda", item.params);
    } catch (error) {
      return { error: { message: String((error && error.message) || error) } };
    }
  },
});

// Mesma conta do banco: o desconto reduz o preço de cada peça (em centavos) e a taxa vem sobre o total.
function calcularVendaPendente(params) {
  const desconto = params.p_desconto || 0;
  const preco = (i) => round2(i.preco * (1 - desconto / 100));
  const subtotal = params.p_itens.reduce((sum, i) => sum + i.quantidade * i.preco, 0);
  const total = params.p_itens.reduce((sum, i) => sum + i.quantidade * preco(i), 0);
  const valorTaxa = round2((total * (params.p_taxa || 0)) / 100);
  const cobrado = params.p_taxa_paga_por === "loja" ? total : total + valorTaxa;
  return { subtotal, total, valorTaxa, cobrado, preco };
}

// Mostra as vendas guardadas no aparelho como se já estivessem no sistema (estoque, totais e lista),
// marcadas como "aguardando envio". Vendas que o banco recusou ficam de fora até a pessoa resolver.
function aplicarPendentes() {
  fila.itens().forEach((item) => {
    if (item.erro || cache.vendas.some((v) => v.id === item.id)) return;
    const p = item.params;
    const c = calcularVendaPendente(p);
    p.p_itens.forEach((i) => {
      const peca = cache.estoque.find((x) => x.id === i.estoque_id);
      if (peca) peca.quantidade = Math.max(0, peca.quantidade - i.quantidade);
    });
    cache.vendas.unshift({
      id: item.id,
      data: p.p_data,
      clienteId: p.p_cliente_id,
      forma: p.p_forma,
      total: round2(c.total),
      parcelas: p.p_parcelas || 1,
      desconto: p.p_desconto || 0,
      subtotal: round2(c.subtotal),
      taxa: p.p_taxa || 0,
      taxaPagaPor: p.p_taxa_paga_por,
      valorTaxa: c.valorTaxa,
      totalCobrado: round2(c.cobrado),
      numero: null,
      obs: p.p_obs || "",
      prazoDias: p.p_prazo_dias || null,
      vencimento: p.p_prazo_dias ? addDaysISO(p.p_data, p.p_prazo_dias) : null,
      recebidaEm: null,
      estornada: false,
      pendente: true,
      itens: p.p_itens.map((i) => {
        const peca = cache.estoque.find((x) => x.id === i.estoque_id);
        return { estoqueId: i.estoque_id, quantidade: i.quantidade, preco: c.preco(i), precoTabela: i.preco, custo: peca ? peca.custoTotal : 0 };
      }),
    });
    const cliente = cache.clientes.find((x) => x.id === p.p_cliente_id);
    if (cliente) cliente.compras.push({ id: `pendente-${item.id}`, data: p.p_data, valor: round2(c.total), descricao: "Venda" });
  });
}

// Entrega as vendas guardadas e, se alguma foi, recarrega os dados do banco.
async function sincronizarVendas() {
  if (!db || (fila.itens().length === 0 && !modoCopia)) return;
  if (modoCopia && navigator.onLine) {
    const { data } = await db.auth.getSession();
    if (data.session) {
      try {
        await refreshAll();
        modoCopia = false;
      } catch (error) {
        // Ainda sem conexão com o banco: continua na cópia local.
      }
    }
  }
  const resultado = await fila.sincronizar();
  if (resultado.enviadas > 0 && !modoCopia) {
    try {
      await refreshAll();
    } catch (error) {
      // Os dados serão recarregados na próxima tentativa.
    }
  }
  renderOfflineBar(resultado.parou);
}

function renderOfflineBar(parou) {
  const bar = document.getElementById("offline-bar");
  if (!bar) return;
  const semSinal = !navigator.onLine;
  const pendentes = fila.pendentes();
  const erros = fila.comErro();
  if (!semSinal && !modoCopia && pendentes === 0 && erros.length === 0) {
    bar.hidden = true;
    return;
  }
  const partes = [];
  if (semSinal) {
    partes.push(`<p><strong>Sem internet.</strong> Pode continuar vendendo: as vendas ficam guardadas neste aparelho e são enviadas quando o sinal voltar.${modoCopia ? " Os dados mostrados são da última vez que o sistema abriu com internet." : ""}</p>`);
  }
  if (pendentes > 0) {
    partes.push(`<p>${pendentes} venda(s) aguardando envio${semSinal ? "" : "…"}</p>`);
  }
  if (!semSinal && (parou === "login" || (modoCopia && pendentes + erros.length > 0))) {
    partes.push('<p>A internet voltou, mas é preciso entrar de novo para enviar. <button type="button" class="link-btn" data-fila="entrar">Entrar</button></p>');
  }
  erros.forEach((item) => {
    const c = calcularVendaPendente(item.params);
    partes.push(`<p class="offline-erro">A venda de ${formatDate(item.params.p_data)} (${brl.format(c.total)}) não foi aceita: ${escapeHtml(item.erro)}
      <button type="button" class="link-btn" data-fila="retry" data-id="${item.id}">Tentar de novo</button>
      <button type="button" class="link-btn" data-fila="drop" data-id="${item.id}">Descartar</button></p>`);
  });
  bar.innerHTML = partes.join("");
  bar.hidden = false;
}

function initOffline() {
  const bar = document.getElementById("offline-bar");
  if (bar) {
    bar.addEventListener("click", async (event) => {
      const { fila: acao, id } = event.target.dataset;
      if (!acao) return;
      if (acao === "entrar") {
        window.location.reload();
      } else if (acao === "drop") {
        if (!window.confirm("Descartar esta venda? Ela não será registrada no sistema.")) return;
        fila.descartar(id);
        await refreshFromCacheOrDb();
      } else if (acao === "retry") {
        fila.tentarDeNovo(id);
        await sincronizarVendas();
      }
    });
  }
  fila.aoMudar(() => renderOfflineBar());
  window.addEventListener("online", sincronizarVendas);
  window.addEventListener("offline", () => renderOfflineBar());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) sincronizarVendas();
  });
  setInterval(sincronizarVendas, 20000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

// Recarrega a tela depois de mexer na fila: do banco, ou da cópia local se estiver sem conexão.
async function refreshFromCacheOrDb() {
  try {
    await refreshAll();
  } catch (error) {
    if (carregarCopiaLocal()) renderers.forEach((render) => render());
  }
  renderOfflineBar();
}

function carregarCopiaLocal() {
  const copia = lerCopiaLocal();
  if (!copia) return false;
  Object.keys(cache).forEach((chave) => {
    cache[chave] = copia[chave] || [];
  });
  aplicarPendentes();
  modoCopia = true;
  return true;
}

function friendlyError(error) {
  const detail = error && error.message ? ` (${error.message})` : "";
  return `Não foi possível salvar. Verifique a conexão e tente de novo.${detail}`;
}

// ---------- Custos e lucro (usado em várias telas) ----------

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const pct = (value) => `${value.toFixed(1).replace(".", ",")}%`;

// Custos e lucro de um período. Vendas desfeitas ficam de fora.
//  faturamento      = o que entrou nas vendas (já com desconto)
//  custoVendido     = custo das peças vendidas (produto + transporte da viagem)
//  lucroBruto       = faturamento - custoVendido
//  despesas         = saídas lançadas à mão no Financeiro (energia, cápsulas, aluguel...)
//  lucroLiquido     = lucroBruto - despesas
//  caixa            = tudo que entrou e saiu (inclui compras de peças e transporte)
function profitSummary(inRange = () => true) {
  const ativas = cache.vendas.filter((v) => !v.estornada && inRange(v.data));
  let faturamento = 0;
  let custoVendido = 0;
  let pecas = 0;
  ativas.forEach((v) => {
    faturamento += v.total;
    v.itens.forEach((i) => {
      custoVendido += i.quantidade * i.custo;
      pecas += i.quantidade;
    });
  });
  const lanc = cache.lancamentos.filter((l) => inRange(l.data));
  const soma = (origem, tipo) => lanc.filter((l) => l.origem === origem && l.tipo === tipo).reduce((s, l) => s + l.valor, 0);
  const comprasPecas = soma("compra_pecas", "saida") - soma("estorno_compra", "entrada");
  const transporte = soma("viagem", "saida") - soma("estorno_viagem", "entrada");
  const despesas = soma("manual", "saida");
  const taxas = soma("taxa_maquininha", "saida") - soma("estorno_taxa", "entrada");
  const lucroBruto = faturamento - custoVendido;
  return {
    vendas: ativas.length,
    pecas,
    faturamento,
    custoVendido,
    lucroBruto,
    margem: faturamento > 0 ? (lucroBruto / faturamento) * 100 : 0,
    markup: custoVendido > 0 ? (lucroBruto / custoVendido) * 100 : 0,
    comprasPecas,
    transporte,
    despesas,
    taxas,
    lucroLiquido: lucroBruto - despesas - taxas,
    entradas: sumByTipo(lanc, "entrada"),
    saidas: sumByTipo(lanc, "saida"),
  };
}

// Cartão grande de indicador; "tone" destaca (rosa) ou avisa (vermelho) e "sub" é a linha de apoio.
function kpiCard(label, value, { sub = "", tone = "", negative = false } = {}) {
  return `<div class="card kpi ${tone}"><span class="muted small">${label}</span><strong class="${negative ? "neg" : ""}">${value}</strong>${sub ? `<span class="kpi-sub">${sub}</span>` : ""}</div>`;
}

// Bloco "Custos e lucro": a resposta de quanto custou, quanto ficou e quanto sobrou.
function profitBlockHtml(s, title = "Custos e lucro") {
  return `
    <div class="profit-block">
      <h2>${title}</h2>
      <div class="kpis">
        ${kpiCard("Faturamento (vendas)", moneyText(s.faturamento), { sub: `${s.vendas} venda(s) · ${s.pecas} peça(s)` })}
        ${kpiCard("Custo das peças vendidas", moneyText(s.custoVendido), { sub: "produto + transporte da viagem", tone: "cost" })}
        ${kpiCard("Lucro bruto", moneyText(s.lucroBruto), { sub: `${pct(s.margem)} da venda · ${pct(s.markup)} sobre o custo`, tone: "profit", negative: s.lucroBruto < 0 })}
        ${kpiCard("Despesas lançadas", moneyText(s.despesas), { sub: "energia, cápsulas, aluguel...", tone: "cost" })}
        ${kpiCard("Taxas da maquininha", moneyText(s.taxas), { sub: "as que a loja pagou nas vendas no cartão", tone: "cost" })}
        ${kpiCard("Lucro líquido", moneyText(s.lucroLiquido), { sub: "lucro bruto − despesas − taxas", tone: "profit", negative: s.lucroLiquido < 0 })}
      </div>
      <div class="kpis">
        ${kpiCard("Compras de peças (caixa)", moneyText(s.comprasPecas), { sub: "o que saiu para comprar estoque", tone: "cost" })}
        ${kpiCard("Transporte das viagens (caixa)", moneyText(s.transporte), { sub: "combustível + pedágio", tone: "cost" })}
        ${kpiCard("Entradas no caixa", moneyText(s.entradas))}
        ${kpiCard("Saídas do caixa", moneyText(s.saidas))}
        ${kpiCard("Resultado do caixa", moneyText(s.entradas - s.saidas), { negative: s.entradas - s.saidas < 0 })}
      </div>
    </div>`;
}

// ---------- Viagens ----------

// Com a sigla do estado a busca no mapa acerta a cidade (há várias cidades e bairros com o mesmo nome).
const DEFAULT_ROUTE = ["Sorocaba, SP", "Piedade, SP", "São Paulo, SP"];
const shortPlace = (name) => String(name).split(",")[0].trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Procura o local no mapa (OpenStreetMap/Nominatim). Guarda a resposta para não repetir a busca.
async function geocodePlace(name) {
  const key = name.trim().toLowerCase();
  try {
    const saved = JSON.parse(localStorage.getItem(`majen:geo:${key}`) || "null");
    if (saved) return { ...saved, fromCache: true };
  } catch (error) {
    // Sem armazenamento local, a busca é refeita.
  }
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${name}, Brasil`)}&format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`a busca de "${name}" falhou (${response.status})`);
  const results = await response.json();
  if (!results.length) throw new Error(`não encontrei "${name}" no mapa`);
  const found = { lat: Number(results[0].lat), lon: Number(results[0].lon), nome: results[0].display_name };
  try {
    localStorage.setItem(`majen:geo:${key}`, JSON.stringify(found));
  } catch (error) {
    // Ignora: só perde o atalho para a próxima vez.
  }
  return found;
}

// Calcula o caminho de carro passando pelos pontos, na ordem (OSRM). Devolve km e minutos de cada trecho.
async function routeBetween(points) {
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`);
  if (!response.ok) throw new Error(`o cálculo da rota falhou (${response.status})`);
  const data = await response.json();
  if (data.code !== "Ok" || !data.routes.length) throw new Error("não encontrei um caminho de carro entre esses pontos");
  const route = data.routes[0];
  return {
    km: route.distance / 1000,
    trechos: route.legs.map((leg) => ({ km: leg.distance / 1000, min: leg.duration / 60 })),
  };
}

// Números de uma viagem: quanto foi investido (transporte + produtos), quanto já voltou em vendas e o lucro projetado.
function tripStats(t) {
  const pecas = cache.estoque.filter((p) => p.viagemId === t.id);
  const ids = new Set(pecas.map((p) => p.id));
  const cadastradas = pecas.reduce((s, p) => s + p.quantidadeInicial, 0);
  const produtos = pecas.reduce((s, p) => s + p.quantidadeInicial * p.custoProduto, 0);
  const noEstoque = pecas.reduce((s, p) => s + p.quantidade * p.precoVenda, 0);
  let vendido = 0;
  cache.vendas
    .filter((v) => !v.estornada)
    .forEach((v) =>
      v.itens.forEach((i) => {
        if (ids.has(i.estoqueId)) vendido += i.quantidade * i.preco;
      })
    );
  const investido = t.total + produtos;
  const lucroProjetado = vendido + noEstoque - investido;
  return {
    cadastradas, produtos, investido, vendido, noEstoque, lucroProjetado,
    lucroPct: investido > 0 ? (lucroProjetado / investido) * 100 : 0,
  };
}

function initTrips() {
  const form = document.getElementById("trip-form");
  if (!form) return;

  const preview = document.getElementById("trip-preview");
  const message = document.getElementById("trip-message");
  const list = document.getElementById("trip-list");
  const kpis = document.getElementById("trip-kpis");
  const storesBox = document.getElementById("trip-stores");
  const pointsBox = document.getElementById("route-points");
  const returnBox = document.getElementById("route-return");
  const routeMessage = document.getElementById("route-message");
  const routeLegs = document.getElementById("route-legs");
  let routeData = null; // resultado do último "Calcular rota"; some se os pontos mudarem
  form.elements.data.value = todayBR();
  maskDateBR(form.elements.data);

  // ----- Trajeto: pontos editáveis (saída, paradas e destino) -----

  function pointRows() {
    return [...pointsBox.querySelectorAll(".route-point")];
  }

  function labelPoints() {
    const rows = pointRows();
    rows.forEach((row, index) => {
      const isFirst = index === 0;
      const isLast = index === rows.length - 1;
      row.querySelector(".route-label").textContent = isFirst ? "Saída" : isLast ? "Destino" : `Parada ${index}`;
      row.querySelector('[data-field="remover-ponto"]').hidden = isFirst || isLast;
    });
  }

  function addPoint(value = "", beforeLast = false) {
    const row = document.createElement("div");
    row.className = "route-point";
    row.innerHTML = `
      <span class="route-label"></span>
      <input type="text" data-field="ponto" placeholder="Cidade, UF ou endereço" aria-label="Ponto do trajeto">
      <button type="button" class="link-btn" data-field="remover-ponto">Remover</button>`;
    row.querySelector('[data-field="ponto"]').value = value;
    const rows = pointRows();
    if (beforeLast && rows.length >= 2) pointsBox.insertBefore(row, rows[rows.length - 1]);
    else pointsBox.appendChild(row);
    labelPoints();
  }

  const placeNames = () => pointRows().map((row) => row.querySelector('[data-field="ponto"]').value.trim());

  // Texto do trajeto, ex.: Sorocaba → Piedade → São Paulo → Sorocaba
  function routeText() {
    const names = placeNames().filter(Boolean);
    if (names.length === 0) return "";
    return (returnBox.checked ? [...names, names[0]] : names).map(shortPlace).join(" → ");
  }

  function invalidateRoute() {
    if (routeData) {
      routeData = null;
      routeLegs.innerHTML = "";
      routeMessage.textContent = "Você mudou o trajeto. Clique em Calcular rota para atualizar os km.";
    }
  }

  function renderLegs() {
    if (!routeData) {
      routeLegs.innerHTML = "";
      return;
    }
    const rows = routeData.trechos
      .map((t) => `<tr><td>${escapeHtml(shortPlace(t.de))} → ${escapeHtml(shortPlace(t.para))}</td><td>${t.km.toFixed(1).replace(".", ",")} km</td><td>${Math.round(t.min)} min</td></tr>`)
      .join("");
    routeLegs.innerHTML = `
      <table>
        <thead><tr><th>Trecho</th><th>Distância</th><th>Tempo</th></tr></thead>
        <tbody>${rows}<tr class="total-row"><td>Total (${routeData.paradas} parada(s)${routeData.volta ? ", com volta" : ""})</td><td>${routeData.km.toFixed(1).replace(".", ",")} km</td><td>${Math.round(routeData.trechos.reduce((s, t) => s + t.min, 0))} min</td></tr></tbody>
      </table>
      <p class="muted small">Locais encontrados no mapa (confira se são os certos): ${routeData.pontos
        .map((p) => `${escapeHtml(shortPlace(p.nome))} = ${escapeHtml(p.local.split(",").slice(0, 3).join(","))}`)
        .join(" · ")}</p>`;
  }

  // Busca os locais, calcula o caminho de carro e preenche os km da viagem.
  async function calculateRoute() {
    const names = placeNames();
    if (names.length < 2 || names.some((n) => !n)) {
      routeMessage.textContent = "Preencha a saída, as paradas e o destino.";
      return;
    }
    const sequence = returnBox.checked ? [...names, names[0]] : names;
    routeMessage.textContent = "Buscando os locais no mapa...";
    try {
      const places = [];
      for (const name of sequence) {
        const place = await geocodePlace(name);
        places.push({ ...place, pedido: name });
        if (!place.fromCache) await sleep(1100); // a busca gratuita pede no máximo 1 consulta por segundo
      }
      routeMessage.textContent = "Calculando o caminho de carro...";
      const route = await routeBetween(places);
      routeData = {
        km: route.km,
        paradas: Math.max(0, names.length - 2),
        volta: returnBox.checked,
        pontos: places.map((p) => ({ nome: p.pedido, local: p.nome, lat: p.lat, lon: p.lon })),
        trechos: route.trechos.map((t, i) => ({ de: sequence[i], para: sequence[i + 1], km: t.km, min: t.min })),
        fonte: "OpenStreetMap (Nominatim) e OSRM",
        calculadoEm: new Date().toISOString(),
      };
      form.elements.km.value = route.km.toFixed(1);
      routeMessage.textContent = `Rota calculada: ${route.km.toFixed(1).replace(".", ",")} km. Os km da viagem foram atualizados; você ainda pode ajustar.`;
      renderLegs();
      renderPreview();
    } catch (error) {
      routeData = null;
      routeLegs.innerHTML = "";
      routeMessage.textContent = `Não consegui calcular a rota (${error.message}). Você pode digitar os km na mão.`;
    }
  }

  // ----- Cálculo da viagem -----

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
    return values.km > 0 && values.consumo > 0 && values.preco > 0 && Number.isInteger(values.pecas) && values.pecas > 0 && values.pedagio >= 0;
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
      <div class="line total"><span>Custo da viagem (sai do caixa)</span><strong>${brl.format(r.total)}</strong></div>
      <div class="line total"><span>Custo de transporte por peça</span><strong>${brl.format(r.porPeca)}</strong></div>
    `;
  }

  function renderList() {
    const trips = cache.viagens;
    const totalTransporte = trips.reduce((s, t) => s + t.total, 0);
    const totalKm = trips.reduce((s, t) => s + t.km, 0);
    const stats = trips.map((t) => tripStats(t));
    const investido = stats.reduce((s, x) => s + x.investido, 0);
    const lucro = stats.reduce((s, x) => s + x.lucroProjetado, 0);
    kpis.innerHTML = trips.length
      ? [
          kpiCard("Gasto com transporte", moneyText(totalTransporte), { sub: `${trips.length} viagem(ns) · ${totalKm.toFixed(0)} km`, tone: "cost" }),
          kpiCard("Investido (transporte + produtos)", moneyText(investido), { tone: "cost" }),
          kpiCard("Lucro projetado das viagens", moneyText(lucro), { sub: investido > 0 ? `${pct((lucro / investido) * 100)} sobre o investido` : "", tone: "profit", negative: lucro < 0 }),
        ].join("")
      : "";

    if (trips.length === 0) {
      list.innerHTML = '<p class="muted">Nenhuma viagem registrada ainda.</p>';
      return;
    }
    const rows = trips
      .map((t, index) => {
        const s = stats[index];
        const detalhe = t.trajetoDetalhe;
        const paradas = detalhe && Number.isInteger(detalhe.paradas) ? detalhe.paradas : null;
        const dica = detalhe && detalhe.trechos
          ? detalhe.trechos.map((x) => `${shortPlace(x.de)} → ${shortPlace(x.para)}: ${x.km.toFixed(1)} km (${Math.round(x.min)} min)`).join("\n")
          : "";
        const faltam = t.pecas - s.cadastradas;
        return `
          <tr>
            <td>${formatDate(t.data)}</td>
            <td>${escapeHtml(lojasTexto(t))}</td>
            <td title="${escapeHtml(dica)}">${escapeHtml(t.trajeto || "—")}${paradas === null ? "" : `<br><span class="muted small">${paradas === 0 ? "sem paradas" : `${paradas} parada(s)`}</span>`}</td>
            <td>${t.km} km</td>
            <td><strong>${brl.format(t.total)}</strong></td>
            <td>${s.cadastradas}/${t.pecas}${faltam > 0 ? `<br><span class="muted small">faltam ${faltam}</span>` : ""}</td>
            <td>${brl.format(s.produtos)}</td>
            <td><strong>${brl.format(s.investido)}</strong></td>
            <td>${brl.format(s.vendido)}</td>
            <td class="${s.lucroProjetado < 0 ? "tag-out" : "tag-in"}"><strong>${brl.format(s.lucroProjetado)}</strong><br><span class="small">${pct(s.lucroPct)}</span></td>
            <td><button class="link-btn" data-remove="${t.id}" type="button">Remover</button></td>
          </tr>`;
      })
      .join("");
    list.innerHTML = `
      <table>
        <thead>
          <tr><th>Data</th><th>Lojas</th><th>Trajeto</th><th>Km</th><th>Custo da viagem</th><th>Peças cadastradas</th><th>Produtos</th><th>Investido</th><th>Já vendido</th><th>Lucro projetado</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted small">Investido = custo da viagem + produtos das peças cadastradas nela. Lucro projetado = vendido + o que ainda está no estoque (a preço de venda) − investido.</p>`;
  }

  form.addEventListener("input", renderPreview);

  pointsBox.addEventListener("input", invalidateRoute);
  pointsBox.addEventListener("click", (event) => {
    if (event.target.dataset.field !== "remover-ponto") return;
    event.target.closest(".route-point").remove();
    labelPoints();
    invalidateRoute();
  });
  returnBox.addEventListener("change", invalidateRoute);
  document.getElementById("route-add-stop").addEventListener("click", () => {
    addPoint("", true);
    invalidateRoute();
  });
  document.getElementById("route-calc").addEventListener("click", calculateRoute);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = readInputs();
    const dataIso = parseDateBR(form.elements.data.value);
    if (!dataIso || !isValid(values)) {
      message.textContent = "Confira a data (DD/MM/AAAA), os números e a quantidade de peças (número inteiro).";
      return;
    }
    const r = calculateTrip(values);
    const names = placeNames();
    const detalhe = routeData || {
      pontos: names.filter(Boolean).map((nome) => ({ nome })),
      paradas: Math.max(0, names.filter(Boolean).length - 2),
      volta: returnBox.checked,
      calculado: false,
    };
    const lojas = [...storesBox.querySelectorAll("input:checked")].map((input) => input.value);
    message.textContent = "Salvando...";
    const { error } = await db.rpc("registrar_viagem", {
      p_data: dataIso,
      p_km: values.km,
      p_consumo: values.consumo,
      p_tipo_combustivel: form.elements.tipoCombustivel.value,
      p_preco: values.preco,
      p_pedagio: values.pedagio,
      p_pecas: values.pecas,
      p_litros: r.litros,
      p_combustivel: r.combustivel,
      p_total: r.total,
      p_por_peca: r.porPeca,
      p_obs: form.elements.obs.value.trim(),
      p_fornecedor_ids: lojas,
      p_trajeto: routeText(),
      p_trajeto_detalhe: detalhe,
    });
    if (error) {
      message.textContent = `Não foi possível salvar a viagem. ${error.message}`;
      return;
    }
    storesBox.querySelectorAll("input:checked").forEach((input) => {
      input.checked = false;
    });
    message.textContent = `Viagem salva. ${brl.format(r.total)} foram lançados como saída no caixa.`;
    form.elements.pecas.value = "";
    form.elements.obs.value = "";
    await refreshAll();
    renderPreview();
  });

  list.addEventListener("click", async (event) => {
    const id = event.target.dataset.remove;
    if (!id) return;
    const t = cache.viagens.find((x) => x.id === id);
    if (!t) return;
    const s = tripStats(t);
    const aviso = [
      `Remover a viagem de ${formatDate(t.data)}?`,
      `Os ${brl.format(t.total)} do transporte voltam ao caixa como "Estorno de transporte".`,
      s.cadastradas > 0 ? `${s.cadastradas} peça(s) cadastrada(s) nela continuam no estoque e mantêm o custo de transporte já calculado.` : "",
      "Isso não pode ser desfeito.",
    ].filter(Boolean).join("\n");
    if (!window.confirm(aviso)) return;
    const { error } = await db.rpc("remover_viagem", { p_id: id, p_data: todayISO() });
    if (error) {
      message.textContent = `Não foi possível remover a viagem. ${error.message}`;
      return;
    }
    message.textContent = "Viagem removida e transporte estornado no caixa.";
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

  DEFAULT_ROUTE.forEach((name) => addPoint(name));
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
  const summary = document.getElementById("stock-summary");
  const search = document.getElementById("stock-search");
  let photoData = "";
  let editedBy = null; // "margem" ou "preco": qual dos dois você mexeu por último

  // Edição de uma peça já cadastrada: nome, código, categoria, tamanho, cor, fornecedor, foto e preço de venda.
  // Quantidade e custo ficam de fora porque mexem no caixa (use o + e o − da lista).
  const editForm = document.getElementById("stock-edit-form");
  const editMessage = document.getElementById("stock-edit-message");
  const editPhoto = document.getElementById("stock-edit-photo");
  const editInfo = document.getElementById("stock-edit-info");
  let editPhotoData = null; // null = mantém a foto atual

  function openEdit(id) {
    const p = cache.estoque.find((x) => x.id === id);
    if (!p) return;
    editForm.elements.id.value = p.id;
    editForm.elements.nome.value = p.nome;
    editForm.elements.codigo.value = p.codigo;
    editForm.elements.categoria.value = p.categoria;
    editForm.elements.tamanho.value = p.tamanho;
    editForm.elements.cor.value = p.cor;
    editForm.elements.precoVenda.value = p.precoVenda;
    editForm.elements.foto.value = "";
    editForm.elements.fornecedorId.innerHTML = `<option value="">Sem fornecedor</option>${cache.fornecedores
      .map((f) => `<option value="${f.id}">${escapeHtml(f.nome)}</option>`)
      .join("")}`;
    editForm.elements.fornecedorId.value = p.fornecedorId || "";
    editPhotoData = null;
    editPhoto.innerHTML = p.foto ? `<img class="thumb large" src="${p.foto}" alt="Foto atual">` : "";
    editMessage.textContent = "";
    renderEditInfo();
    editForm.hidden = false;
    editForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderEditInfo() {
    const p = cache.estoque.find((x) => x.id === editForm.elements.id.value);
    const preco = num(editForm.elements.precoVenda.value);
    if (!p || !(preco >= 0)) {
      editInfo.textContent = "";
      return;
    }
    const lucro = preco - p.custoTotal;
    editInfo.textContent = `Custo total ${brl.format(p.custoTotal)} · lucro por peça ${brl.format(lucro)}${p.custoTotal > 0 ? ` (${pct((lucro / p.custoTotal) * 100)} sobre o custo)` : ""}`;
  }

  editForm.elements.precoVenda.addEventListener("input", renderEditInfo);
  editForm.elements.foto.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      editPhotoData = await compressPhoto(file);
      editPhoto.innerHTML = `<img class="thumb large" src="${editPhotoData}" alt="Nova foto">`;
    } catch (error) {
      editMessage.textContent = "Não consegui ler esta foto. Tente outra.";
    }
  });
  document.getElementById("stock-edit-cancel").addEventListener("click", () => {
    editForm.hidden = true;
  });
  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = editForm.elements.id.value;
    const nome = editForm.elements.nome.value.trim();
    const precoVenda = num(editForm.elements.precoVenda.value);
    if (!nome || editForm.elements.precoVenda.value === "" || !(precoVenda >= 0)) {
      editMessage.textContent = "Confira o nome e o preço de venda.";
      return;
    }
    editMessage.textContent = "Salvando...";
    const dados = {
      nome,
      categoria: editForm.elements.categoria.value,
      codigo: editForm.elements.codigo.value.trim() || null,
      tamanho: editForm.elements.tamanho.value.trim() || null,
      cor: editForm.elements.cor.value.trim() || null,
      fornecedor_id: editForm.elements.fornecedorId.value || null,
      preco_venda: round2(precoVenda),
    };
    if (editPhotoData !== null) dados.foto = editPhotoData;
    const { error } = await db.from("estoque").update(dados).eq("id", id);
    if (error) {
      editMessage.textContent = friendlyError(error);
      return;
    }
    editForm.hidden = true;
    message.textContent = `Peça "${nome}" atualizada.`;
    await refreshAll();
  });

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

  // Lucro desejado (%) -> preço final: custo total + % de lucro sobre o custo.
  function syncFromMargin() {
    const c = currentCost();
    const m = form.elements.margem.value;
    if (c.total > 0 && m !== "" && Number(m) >= 0) {
      form.elements.precoVenda.value = round2(c.total * (1 + Number(m) / 100)).toFixed(2);
    }
  }

  // Preço digitado -> lucro (%) sobre o custo.
  function syncFromPrice() {
    const c = currentCost();
    const preco = num(form.elements.precoVenda.value);
    if (c.total > 0 && preco > 0) {
      form.elements.margem.value = ((preco / c.total - 1) * 100).toFixed(1);
    } else if (!form.elements.precoVenda.value) {
      form.elements.margem.value = "";
    }
  }

  function resync() {
    if (editedBy === "margem") syncFromMargin();
    else if (editedBy === "preco") syncFromPrice();
  }

  function renderPreview() {
    const c = currentCost();
    if (!form.elements.custoProduto.value) {
      preview.innerHTML = '<p class="muted">Informe o custo do produto para ver o custo total e o lucro.</p>';
      return;
    }
    const quantidade = Math.max(0, num(form.elements.quantidade.value) || 0);
    const preco = num(form.elements.precoVenda.value);
    const sugerido = suggestPrice(c.total);
    let html = `
      <div class="line"><span>Produto</span><strong>${brl.format(c.custoProduto)}</strong></div>
      <div class="line"><span>Transporte (viagem)</span><strong>${brl.format(c.custoTransporte)}</strong></div>
      <div class="line total"><span>Custo total por peça</span><strong>${brl.format(c.total)}</strong></div>`;
    if (preco > 0 && c.total > 0) {
      const lucro = preco - c.total;
      html += `
        <div class="line"><span>Preço de venda</span><strong>${brl.format(preco)}</strong></div>
        <div class="line total ${lucro < 0 ? "bad" : ""}"><span>Lucro por peça</span><strong>${brl.format(lucro)}</strong></div>
        <div class="line"><span>Lucro sobre o custo</span><strong>${pct((lucro / c.total) * 100)}</strong></div>
        <div class="line"><span>Margem sobre a venda</span><strong>${pct((lucro / preco) * 100)}</strong></div>`;
      if (quantidade > 0) {
        html += `
        <div class="line"><span>Lote: ${quantidade} peça(s) a ${brl.format(c.custoProduto)} (sai do caixa)</span><strong>${brl.format(quantidade * c.custoProduto)}</strong></div>
        <div class="line"><span>Lote: vendendo tudo, entram</span><strong>${brl.format(quantidade * preco)}</strong></div>
        <div class="line total ${lucro < 0 ? "bad" : ""}"><span>Lote: lucro previsto</span><strong>${brl.format(quantidade * lucro)}</strong></div>`;
      }
      if (lucro < 0) html += '<p class="warn small">Atenção: o preço está abaixo do custo. Essa peça dá prejuízo.</p>';
    } else {
      html += `<div class="line total"><span>Sugestão (30% de margem + 9% de taxas)</span><strong>${brl.format(sugerido)}</strong></div>
        <p class="muted small">Digite o lucro desejado (%) ou o preço de venda para ver o lucro.</p>`;
      if (!form.elements.precoVenda.value) form.elements.precoVenda.placeholder = sugerido.toFixed(2).replace(".", ",");
    }
    preview.innerHTML = html;
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

    const unidades = cache.estoque.reduce((s, p) => s + p.quantidade, 0);
    const custo = cache.estoque.reduce((s, p) => s + p.quantidade * p.custoTotal, 0);
    const venda = cache.estoque.reduce((s, p) => s + p.quantidade * p.precoVenda, 0);
    summary.innerHTML = cache.estoque.length
      ? [
          kpiCard("Peças em estoque", String(unidades), { sub: `${cache.estoque.length} item(ns) diferente(s)` }),
          kpiCard("Custo do estoque", moneyText(custo), { sub: "o que foi investido nelas", tone: "cost" }),
          kpiCard("Valor de venda do estoque", moneyText(venda)),
          kpiCard("Lucro potencial", moneyText(venda - custo), { sub: custo > 0 ? `${pct(((venda - custo) / custo) * 100)} sobre o custo` : "", tone: "profit", negative: venda - custo < 0 }),
        ].join("")
      : "";

    const term = search.value.trim().toLowerCase();
    const items = cache.estoque.filter(
      (p) => !term || [p.codigo, p.nome, fornecedorDe(p), p.cor, p.tamanho].some((field) => (field || "").toLowerCase().includes(term))
    );
    if (items.length === 0) {
      list.innerHTML = `<p class="muted">${term ? "Nenhuma peça encontrada." : "Nenhuma peça cadastrada ainda."}</p>`;
      return;
    }
    const rows = items
      .map((item) => {
        const lucro = item.precoVenda - item.custoTotal;
        const lucroPct = item.custoTotal > 0 ? (lucro / item.custoTotal) * 100 : 0;
        return `
        <tr>
          <td>${item.foto ? `<img class="thumb" src="${item.foto}" alt="">` : "—"}</td>
          <td>${escapeHtml(item.codigo || "—")}</td>
          <td>${escapeHtml(item.nome)}</td>
          <td>${escapeHtml(fornecedorDe(item) || "—")}</td>
          <td>${escapeHtml(categoriaEstoque(item.categoria))}</td>
          <td>${escapeHtml(item.tamanho || "—")}</td>
          <td>${escapeHtml(item.cor || "—")}</td>
          <td>
            <button class="link-btn" data-baixa="${item.id}" type="button" title="Dar baixa (perda, quebra, ajuste)">−</button>
            <strong>${item.quantidade}</strong>
            <button class="link-btn" data-repor="${item.id}" type="button" title="Chegaram mais unidades (debita o caixa)">+</button>
          </td>
          <td>${brl.format(item.custoTotal)}</td>
          <td><strong>${brl.format(item.precoVenda)}</strong></td>
          <td class="${lucro < 0 ? "tag-out" : "tag-in"}"><strong>${brl.format(lucro)}</strong><br><span class="small">${pct(lucroPct)}</span></td>
          <td><button class="link-btn" data-editar="${item.id}" type="button">Editar</button> <button class="link-btn" data-remove="${item.id}" type="button">Remover</button></td>
        </tr>`;
      })
      .join("");
    list.innerHTML = `
      <table>
        <thead>
          <tr><th>Foto</th><th>Código</th><th>Nome</th><th>Fornecedor</th><th>Categoria</th><th>Tamanho</th><th>Cor</th><th>Qtd</th><th>Custo</th><th>Venda</th><th>Lucro por peça</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted small">Custo = produto + transporte da viagem. Lucro % = lucro sobre o custo. O botão + registra a chegada de mais unidades e debita o caixa; o − dá baixa sem mexer no caixa.</p>`;
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

  form.addEventListener("input", (event) => {
    const name = event.target.name;
    if (name === "margem") {
      editedBy = "margem";
      syncFromMargin();
    } else if (name === "precoVenda") {
      editedBy = "preco";
      syncFromPrice();
    } else if (name === "custoProduto") {
      resync();
    }
    renderPreview();
  });

  tripSelect.addEventListener("change", () => {
    // Se a viagem passou numa loja só e o fornecedor ainda está em branco, já sugere essa loja.
    const trip = cache.viagens.find((t) => t.id === tripSelect.value);
    if (trip && trip.fornecedorIds.length === 1 && !form.elements.fornecedorId.value) {
      form.elements.fornecedorId.value = trip.fornecedorIds[0];
    }
    resync();
    renderPreview();
  });
  search.addEventListener("input", renderList);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nome = form.elements.nome.value.trim();
    const quantidade = num(form.elements.quantidade.value);
    const custoProduto = num(form.elements.custoProduto.value);
    if (!nome || !Number.isInteger(quantidade) || quantidade < 1 || form.elements.custoProduto.value === "" || custoProduto < 0) {
      message.textContent = "Confira nome, quantidade (número inteiro) e custo do produto.";
      return;
    }
    const c = currentCost();
    const precoVenda = num(form.elements.precoVenda.value) || suggestPrice(c.total);
    message.textContent = "Salvando...";
    const { error } = await db.rpc("registrar_entrada_estoque", {
      p_nome: nome,
      p_categoria: form.elements.categoria.value,
      p_quantidade: quantidade,
      p_custo_produto: custoProduto,
      p_custo_transporte: c.custoTransporte,
      p_custo_total: c.total,
      p_preco_venda: precoVenda,
      p_data: todayISO(),
      p_codigo: form.elements.codigo.value.trim() || null,
      p_fornecedor_id: form.elements.fornecedorId.value || null,
      p_tamanho: form.elements.tamanho.value.trim() || null,
      p_cor: form.elements.cor.value.trim() || null,
      p_viagem_id: tripSelect.value || null,
      p_foto: photoData || null,
    });
    if (error) {
      message.textContent = `Não foi possível salvar a peça. ${error.message}`;
      return;
    }
    message.textContent = `Peça salva. ${brl.format(quantidade * custoProduto)} foram lançados como saída no caixa (compra de peças).`;
    form.reset();
    form.elements.quantidade.value = 1;
    editedBy = null;
    photoData = "";
    photoPreview.innerHTML = "";
    await refreshAll();
    renderPreview();
  });

  // Pede um número inteiro positivo; devolve null se cancelar ou digitar algo inválido.
  function askQuantity(text) {
    const answer = window.prompt(text, "1");
    if (answer === null) return null;
    const n = Number(answer.replace(",", "."));
    if (!Number.isInteger(n) || n < 1) {
      message.textContent = "Informe um número inteiro de 1 em diante.";
      return null;
    }
    return n;
  }

  list.addEventListener("click", async (event) => {
    const { repor, baixa, remove, editar } = event.target.dataset;
    if (editar) {
      openEdit(editar);
      return;
    }
    if (repor) {
      const item = cache.estoque.find((i) => i.id === repor);
      if (!item) return;
      const n = askQuantity(`Quantas unidades de "${item.nome}" chegaram?\nCada uma custa ${brl.format(item.custoProduto)} e o total será lançado como saída no caixa.`);
      if (n === null) return;
      const { error } = await db.rpc("repor_estoque", { p_estoque_id: repor, p_quantidade: n, p_data: todayISO() });
      if (error) {
        message.textContent = `Não foi possível repor. ${error.message}`;
        return;
      }
      message.textContent = `${n} unidade(s) adicionadas. ${brl.format(n * item.custoProduto)} lançados como saída no caixa.`;
    } else if (baixa) {
      const item = cache.estoque.find((i) => i.id === baixa);
      if (!item) return;
      const n = askQuantity(`Dar baixa em quantas unidades de "${item.nome}"?\nUse para perda, quebra ou ajuste. Isso NÃO mexe no caixa. Para uma venda, use a aba Vendas.`);
      if (n === null) return;
      const { error } = await db.rpc("baixar_estoque", { p_estoque_id: baixa, p_quantidade: n });
      if (error) {
        message.textContent = `Não foi possível dar baixa. ${error.message}`;
        return;
      }
      message.textContent = `Baixa de ${n} unidade(s) registrada (sem mexer no caixa).`;
    } else if (remove) {
      const item = cache.estoque.find((i) => i.id === remove);
      if (!item) return;
      const aviso = [
        `Remover "${item.nome}" do estoque?`,
        "Use só se cadastrou por engano. O valor da compra volta ao caixa como \"Estorno de compra\".",
        "Peça que já teve venda não pode ser removida.",
      ].join("\n");
      if (!window.confirm(aviso)) return;
      const { error } = await db.rpc("remover_peca", { p_estoque_id: remove, p_data: todayISO() });
      if (error) {
        message.textContent = `Não foi possível remover. ${error.message}`;
        return;
      }
      message.textContent = "Peça removida e compra estornada no caixa.";
    } else {
      return;
    }
    await refreshAll();
  });

  renderers.push(renderList);
  renderers.push(renderPreview);
}

// ---------- Vitrine ----------

// Peças disponíveis só com o preço de venda (sem custo, lucro nem quantidade), para consulta e para mostrar à cliente.
function initVitrine() {
  const grid = document.getElementById("vitrine-grid");
  if (!grid) return;

  const search = document.getElementById("vitrine-search");
  const catBox = document.getElementById("vitrine-categorias");
  const modoBtn = document.getElementById("vitrine-modo");
  const sairBtn = document.getElementById("vitrine-sair");
  let categoria = "todas";

  function render() {
    const disponiveis = cache.estoque.filter((p) => p.quantidade > 0);
    const presentes = Object.keys(CATEGORIAS_ESTOQUE).filter((c) => disponiveis.some((p) => p.categoria === c));
    if (categoria !== "todas" && !presentes.includes(categoria)) categoria = "todas";
    catBox.innerHTML = ["todas", ...presentes]
      .map((c) => `<button type="button" class="pill ${c === categoria ? "on" : ""}" data-cat="${c}">${c === "todas" ? "Todas" : categoriaEstoque(c)}</button>`)
      .join("");

    const term = search.value.trim().toLowerCase();
    const itens = disponiveis
      .filter((p) => categoria === "todas" || p.categoria === categoria)
      .filter((p) => !term || [p.nome, p.codigo, p.tamanho, p.cor].some((f) => (f || "").toLowerCase().includes(term)))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    grid.innerHTML = itens.length
      ? itens
          .map(
            (p) => `
        <div class="vitrine-card">
          <div class="vitrine-foto">${p.foto ? `<img src="${p.foto}" alt="${escapeHtml(p.nome)}" loading="lazy">` : "<span>sem foto</span>"}</div>
          <div class="vitrine-info">
            <div class="vitrine-nome">${escapeHtml(p.nome)}</div>
            <div class="muted small">${escapeHtml([p.codigo, p.tamanho, p.cor].filter(Boolean).join(" · "))}</div>
            <div class="vitrine-preco">${brl.format(p.precoVenda)}</div>
          </div>
        </div>`
          )
          .join("")
      : `<p class="muted">${term || categoria !== "todas" ? "Nenhuma peça encontrada." : "Nenhuma peça disponível no estoque."}</p>`;
  }

  search.addEventListener("input", render);
  catBox.addEventListener("click", (event) => {
    if (!event.target.dataset.cat) return;
    categoria = event.target.dataset.cat;
    render();
  });
  // Modo cliente: esconde o menu e trava na vitrine. É só uma comodidade, não uma proteção.
  modoBtn.addEventListener("click", () => {
    document.body.classList.add("modo-cliente");
    sairBtn.hidden = false;
    window.location.hash = "#vitrine";
    showRoute();
  });
  sairBtn.addEventListener("click", () => {
    document.body.classList.remove("modo-cliente");
    sairBtn.hidden = true;
    showRoute();
  });

  renderers.push(render);
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
  const formTitle = document.getElementById("client-form-title");
  const submitButton = document.getElementById("client-submit");
  const cancelButton = document.getElementById("client-cancel");
  let selectedId = null;
  let editingId = null;

  // Carrega a cliente no formulário para editar (ou limpa o formulário, voltando a "Novo cliente").
  function setEditing(id) {
    editingId = id;
    const c = cache.clientes.find((x) => x.id === id);
    formTitle.textContent = c ? "Editar cliente" : "Novo cliente";
    submitButton.textContent = c ? "Salvar alterações" : "Salvar cliente";
    cancelButton.hidden = !c;
    if (!c) {
      form.reset();
      return;
    }
    form.elements.nome.value = c.nome;
    form.elements.whatsapp.value = c.whatsapp;
    form.elements.aniversario.value = c.aniversario ? formatDate(c.aniversario) : "";
    form.elements.origem.value = c.origem;
    form.elements.indicadaPor.value = c.indicadaPor;
    form.elements.tamanho.value = c.tamanho;
    form.elements.perfume.value = c.perfume;
    form.elements.estilo.value = c.estilo;
    form.elements.consentWhats.checked = c.consentWhats;
    form.elements.consentPromo.checked = c.consentPromo;
    form.elements.obs.value = c.obs;
  }

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
        <div>
          <button class="link-btn" data-edit="1" type="button">Editar cadastro</button>
          <button class="link-btn" data-close="1" type="button">Fechar</button>
        </div>
      </div>
      <p class="muted small">
        WhatsApp ${escapeHtml(client.whatsapp)} · Aniversário ${formatDate(client.aniversario)} ·
        Origem: ${escapeHtml(client.origem || "—")} · Tamanho: ${escapeHtml(client.tamanho || "—")} ·
        Perfume: ${escapeHtml(client.perfume || "—")} · Estilo: ${escapeHtml(client.estilo || "—")} ·
        Consentimento: ${consent}
      </p>
      ${client.obs ? `<p class="small">${escapeHtml(client.obs)}</p>` : ""}
      <p><strong>Total gasto:</strong> ${brl.format(totalSpent(client))} em ${client.compras.length} compra(s)</p>

      <h3>Registrar compra antiga</h3>
      <p class="muted small">Só para compras de antes do sistema. Ela entra no total gasto da cliente, mas não baixa o estoque nem entra no caixa. Vendas novas devem ser registradas na aba Vendas.</p>
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
    const existing = cache.clientes.find((c) => c.whatsapp === whatsapp && c.id !== editingId);
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
    const dados = {
      nome,
      whatsapp,
      aniversario: aniversarioIso,
      origem: form.elements.origem.value || null,
      indicada_por: form.elements.indicadaPor.value.trim() || null,
      tamanho: form.elements.tamanho.value.trim() || null,
      perfume: form.elements.perfume.value.trim() || null,
      estilo: form.elements.estilo.value.trim() || null,
      consent_whats: consentWhats,
      consent_promo: consentPromo,
      obs: form.elements.obs.value.trim() || null,
    };
    // A data do consentimento só muda quando o consentimento muda (ao editar, mantém a data original).
    const atual = editingId ? cache.clientes.find((c) => c.id === editingId) : null;
    if (!atual || consentWhats !== atual.consentWhats) dados.consent_whats_em = consentWhats ? todayISO() : null;
    if (!atual || consentPromo !== atual.consentPromo) dados.consent_promo_em = consentPromo ? todayISO() : null;

    const { error } = editingId
      ? await db.from("clientes").update(dados).eq("id", editingId)
      : await db.from("clientes").insert(dados);
    if (error) {
      message.textContent = friendlyError(error);
      return;
    }
    message.textContent = editingId ? "Cadastro atualizado." : "Cliente salvo.";
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
    if (event.target.dataset.edit && selectedId) {
      setEditing(selectedId);
      message.textContent = "";
      form.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
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

// ---------- Recibo (PDF) ----------

// Porcentagem sem casa decimal quando é inteira (10% em vez de 10,0%).
const pctClean = (value) => (Number.isInteger(value) ? `${value}%` : pct(value));

const receiptNumber = (v) => (v.numero ? String(v.numero).padStart(4, "0") : "sem número");

function formatWhats(value) {
  const d = onlyDigits(value);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return value;
}

// Nome do arquivo sem acentos nem símbolos, ex.: recibo-0012-ana-souza.pdf
function receiptFileName(v) {
  const cliente = cache.clientes.find((c) => c.id === v.clienteId);
  const slug = (cliente ? cliente.nome : "venda-avulsa")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `recibo-${v.numero ? String(v.numero).padStart(4, "0") : "venda"}-${slug}.pdf`;
}

// Monta o recibo de uma venda, simples e minimalista, no formato A5. Textos fixos da loja (contato e
// observação) vêm do config.js; o resto sai da própria venda.
function buildReceipt(v) {
  if (!window.jspdf) throw new Error("A biblioteca de PDF não carregou. Verifique a internet.");
  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a5" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 34;
  const ROSE = [135, 87, 101];
  const BLUSH = [241, 221, 225];
  const PAPER = [251, 245, 239];
  const GOLD = [197, 167, 121];
  const INK = [74, 58, 64];
  const MUTED = [122, 102, 112];
  const loja = (window.MAJEN_CONFIG && window.MAJEN_CONFIG.recibo) || {};

  const paintPaper = () => {
    doc.setFillColor(...PAPER);
    doc.rect(0, 0, W, H, "F");
  };
  paintPaper();

  // Dados da venda
  const cliente = cache.clientes.find((c) => c.id === v.clienteId);
  const itens = v.itens.map((i) => {
    const p = cache.estoque.find((x) => x.id === i.estoqueId);
    return {
      qtd: i.quantidade,
      nome: p ? p.nome : "Peça",
      detalhe: [p && p.tamanho ? `Tam. ${p.tamanho}` : "", p && p.cor ? p.cor : "", p && p.codigo ? `Cód. ${p.codigo}` : ""].filter(Boolean).join(" · "),
      unit: i.precoTabela,
      total: i.quantidade * i.precoTabela,
    };
  });
  const subtotal = itens.reduce((s, i) => s + i.total, 0);
  const desconto = round2(subtotal - v.total); // inclui o arredondamento por peça, para as linhas fecharem
  const taxaCliente = v.taxaPagaPor === "cliente" ? v.valorTaxa : 0;
  const cobrado = v.taxaPagaPor === "cliente" ? v.totalCobrado : v.total;

  // Cabeçalho
  doc.setFont("times", "normal");
  doc.setFontSize(26);
  doc.setTextColor(...ROSE);
  doc.text("MAJEN", M, 62, { charSpace: 6 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Moda e perfumaria", M, 77);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...ROSE);
  doc.text(`Recibo nº ${receiptNumber(v)}`, W - M, 54, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(formatDate(v.data), W - M, 68, { align: "right" });
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.9);
  doc.line(M, 88, W - M, 88);

  // Cliente
  doc.setFontSize(7.5);
  doc.text("CLIENTE", M, 112, { charSpace: 1 });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(cliente ? cliente.nome : "Venda avulsa", M, 127);
  if (cliente) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(`WhatsApp ${formatWhats(cliente.whatsapp)}`, M, 140);
  }

  // Itens
  doc.autoTable({
    startY: 156,
    head: [["Qtd", "Descrição", "Valor un.", "Total"]],
    body: itens.map((i) => [String(i.qtd), `${i.nome}${i.detalhe ? "\n " : ""}`, moneyText(i.unit), moneyText(i.total)]),
    theme: "plain",
    margin: { left: M, right: M, bottom: 60 },
    styles: { fontSize: 9, textColor: INK, cellPadding: { top: 6, bottom: 6, left: 0, right: 0 }, valign: "top" },
    headStyles: { textColor: ROSE, fontSize: 8, fontStyle: "bold", cellPadding: { top: 3, bottom: 5, left: 0, right: 0 } },
    columnStyles: { 0: { cellWidth: 30 }, 2: { halign: "right", cellWidth: 66 }, 3: { halign: "right", cellWidth: 66 } },
    willDrawPage: (data) => {
      if (data.pageNumber > 1) paintPaper();
    },
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index >= 2) data.cell.styles.halign = "right";
    },
    didDrawCell: (data) => {
      const { cell } = data;
      doc.setDrawColor(...BLUSH);
      doc.setLineWidth(data.section === "head" ? 0.9 : 0.5);
      doc.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
      if (data.section === "body" && data.column.index === 1 && itens[data.row.index].detalhe) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text(itens[data.row.index].detalhe, cell.x, cell.y + 6 + 10.5 + 9);
      }
    },
  });

  // Totais (à direita)
  let y = doc.lastAutoTable.finalY + 16;
  if (y > H - 215) {
    doc.addPage();
    paintPaper();
    y = 48;
  }
  const left = W - M - 190;
  const line = (label, value) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(label, left, y);
    doc.setTextColor(...INK);
    doc.text(value, W - M, y, { align: "right" });
    y += 15;
  };
  line("Subtotal", moneyText(subtotal));
  if (desconto > 0) line(`Desconto (${pctClean(v.desconto)})`, `- ${moneyText(desconto)}`);
  if (taxaCliente > 0) line(`Taxa da maquininha (${pctClean(v.taxa)})`, `+ ${moneyText(taxaCliente)}`);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.8);
  doc.line(left, y - 6, W - M, y - 6);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...ROSE);
  doc.text("Total", left, y);
  doc.setFont("times", "normal");
  doc.setFontSize(17);
  doc.text(moneyText(cobrado), W - M, y + 1, { align: "right" });
  y += 24;

  // Pagamento
  doc.setFillColor(...BLUSH);
  doc.roundedRect(M, y, W - 2 * M, 26, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...ROSE);
  doc.text("Pagamento", M + 10, y + 16);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...INK);
  const pagamento = v.prazoDias
    ? `A prazo · vence em ${formatDate(v.vencimento)}`
    : v.parcelas > 1 ? `${v.forma} · ${v.parcelas}x de ${moneyText(round2(cobrado / v.parcelas))}` : v.forma || "Não informado";
  doc.text(pagamento, W - M - 10, y + 16, { align: "right" });
  y += 42;

  // Observações da venda e da loja
  const notes = [v.obs, loja.observacao].filter(Boolean).join(" ");
  if (notes) {
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(notes, W - 2 * M), M, y);
  }

  // Rodapé
  const footer = H - 74;
  doc.setDrawColor(...BLUSH);
  doc.setLineWidth(0.6);
  doc.line(M, footer, W - M, footer);
  doc.setFont("times", "normal");
  doc.setFontSize(12);
  doc.setTextColor(...ROSE);
  doc.text("Obrigada pela preferência", W / 2, footer + 20, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  if (loja.frase) {
    doc.setFont("times", "italic");
    doc.setFontSize(9.5);
    doc.text(loja.frase, W / 2, footer + 34, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
  }
  if (loja.contato) doc.text(loja.contato, W / 2, footer + 47, { align: "center" });
  doc.setFontSize(7);
  doc.setTextColor(168, 154, 162);
  doc.text("Este recibo não substitui nota fiscal.", W / 2, footer + 61, { align: "center" });
  return doc;
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
  const breakdown = document.getElementById("sale-breakdown");
  const feeBox = document.getElementById("sale-fee-box");
  const totalLabel = document.getElementById("sale-total-label");
  const parcelasLabel = document.getElementById("sale-parcelas-label");
  const parcelasSelect = form.elements.parcelas;
  const isCredit = () => form.elements.forma.value === "Cartão de crédito";
  const isPrazo = () => form.elements.forma.value === "A prazo";
  const prazoLabel = document.getElementById("sale-prazo-label");
  const prazoInfo = document.getElementById("sale-prazo-info");
  const receivableBox = document.getElementById("sale-receivable");

  // Venda a prazo: mostra o campo de dias e já calcula a data de vencimento.
  function renderPrazo() {
    prazoLabel.hidden = !isPrazo();
    const dias = Number(form.elements.prazoDias.value);
    const dataIso = parseDateBR(form.elements.data.value);
    prazoInfo.textContent = isPrazo() && Number.isInteger(dias) && dias >= 1 && dataIso ? `Vence em ${formatDate(addDaysISO(dataIso, dias))}` : "";
  }

  // Opções de 1x a 12x, já mostrando o valor de cada parcela. Só aparece no cartão de crédito.
  function renderParcelas(total) {
    parcelasLabel.hidden = !isCredit();
    feeBox.hidden = !isCredit();
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

  // Desconto em % digitado pela pessoa, limitado de 0 a 99,9.
  const discountPct = () => {
    const d = num(form.elements.desconto.value || 0);
    return Number.isFinite(d) ? Math.min(Math.max(d, 0), 99.9) : 0;
  };

  // Mesma regra do banco: o desconto reduz o preço de cada peça (arredondado em centavos).
  const finalPrice = (preco, d) => round2(preco * (1 - d / 100));

  // Taxa da maquininha em %, só no cartão de crédito (0 nas outras formas de pagamento).
  const feePct = () => {
    if (!isCredit()) return 0;
    const t = num(form.elements.taxa.value || 0);
    return Number.isFinite(t) ? Math.min(Math.max(t, 0), 49.9) : 0;
  };

  function renderTotal() {
    const d = discountPct();
    const taxa = feePct();
    const quem = form.elements.taxaPaga.value;
    const itens = readItems();
    const subtotal = itens.reduce((sum, i) => sum + i.quantidade * i.preco, 0);
    const total = itens.reduce((sum, i) => sum + i.quantidade * finalPrice(i.preco, d), 0);
    const custo = itens.reduce((sum, i) => {
      const p = cache.estoque.find((x) => x.id === i.estoque_id);
      return sum + i.quantidade * (p ? p.custoTotal : 0);
    }, 0);
    const valorTaxa = round2((total * taxa) / 100);
    const cobrado = quem === "cliente" ? total + valorTaxa : total;

    // O valor grande é o que passa no cartão. Com taxa paga pelo cliente, ele já inclui o acréscimo.
    renderPrazo();
    totalLabel.textContent = taxa > 0 && quem === "cliente" ? "Total a cobrar no cartão" : "Total da venda";
    totalEl.textContent = brl.format(cobrado);
    renderParcelas(cobrado);

    if (!(total > 0)) {
      breakdown.innerHTML = "";
      return;
    }
    const lucro = total - custo - (quem === "loja" ? valorTaxa : 0);
    breakdown.innerHTML = `
      <div class="line"><span>Subtotal (preço de tabela)</span><strong>${brl.format(subtotal)}</strong></div>
      ${d > 0 ? `<div class="line"><span>Desconto de ${pct(d)}</span><strong>− ${brl.format(subtotal - total)}</strong></div>` : ""}
      ${taxa > 0 ? `<div class="line"><span>Valor da venda</span><strong>${brl.format(total)}</strong></div>` : ""}
      ${taxa > 0 && quem === "cliente" ? `<div class="line"><span>Taxa da maquininha (${pct(taxa)}), paga pelo cliente</span><strong>+ ${brl.format(valorTaxa)}</strong></div>` : ""}
      ${taxa > 0 && quem === "loja" ? `<div class="line"><span>Taxa da maquininha (${pct(taxa)}), paga pela loja</span><strong>− ${brl.format(valorTaxa)}</strong></div>` : ""}
      <div class="line"><span>Custo das peças</span><strong>${brl.format(custo)}</strong></div>
      <div class="line total ${lucro < 0 ? "bad" : ""}"><span>Lucro desta venda</span><strong>${brl.format(lucro)} · ${pct((lucro / total) * 100)} da venda</strong></div>
      ${lucro < 0 ? '<p class="warn small">Atenção: esta venda está abaixo do custo e dá prejuízo.</p>' : ""}`;
  }

  // Situação da venda a prazo na coluna de pagamento.
  function prazoStatus(v) {
    if (!v.prazoDias || v.estornada) return "";
    if (v.recebidaEm) return `<br><span class="small tag-in">recebida em ${formatDate(v.recebidaEm)}</span>`;
    const vencida = v.vencimento < todayISO();
    return `<br><span class="small ${vencida ? "tag-out" : "muted"}">${vencida ? "venceu em" : "vence em"} ${formatDate(v.vencimento)}</span>`;
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

    // Vendas a prazo ainda não recebidas.
    const hoje = todayISO();
    const aReceber = cache.vendas.filter((v) => v.prazoDias && !v.recebidaEm && !v.estornada);
    const vencidas = aReceber.filter((v) => v.vencimento < hoje);
    receivableBox.innerHTML = aReceber.length
      ? `<p class="receivable"><strong>A receber: ${brl.format(aReceber.reduce((sum, v) => sum + v.total, 0))}</strong> em ${aReceber.length} venda(s)${vencidas.length ? ` · <span class="tag-out">${vencidas.length} vencida(s)</span>` : ""}</p>`
      : "";

    if (cache.vendas.length === 0) {
      list.innerHTML = '<p class="muted">Nenhuma venda registrada ainda.</p>';
      return;
    }
    const rows = cache.vendas
      .map((v) => {
        const cliente = cache.clientes.find((c) => c.id === v.clienteId);
        const pecas = v.itens.reduce((sum, i) => sum + i.quantidade, 0);
        const lucro = v.itens.reduce((sum, i) => sum + i.quantidade * (i.preco - i.custo), 0) - (v.taxaPagaPor === "loja" ? v.valorTaxa : 0);
        const action = v.pendente
          ? '<span class="muted small">Aguardando envio</span>'
          : v.estornada
          ? '<span class="muted small">Desfeita</span>'
          : `${v.prazoDias && !v.recebidaEm ? `<button class="link-btn" data-receber="${v.id}" type="button">Receber</button>` : ""}
             <button class="link-btn" data-recibo="${v.id}" type="button">Recibo</button>
             <button class="link-btn" data-imprimir="${v.id}" type="button">Imprimir</button>
             <button class="link-btn" data-estornar="${v.id}" type="button">Desfazer</button>`;
        return `
          <tr class="${v.estornada ? "undone" : ""}">
            <td>${formatDate(v.data)}</td>
            <td>${cliente ? escapeHtml(cliente.nome) : "—"}</td>
            <td>${escapeHtml(formaVenda(v) || "—")}${prazoStatus(v)}</td>
            <td>${pecas} peça(s)</td>
            <td>${v.desconto > 0 ? pct(v.desconto) : "—"}</td>
            <td><strong>${brl.format(v.total)}</strong>${v.taxaPagaPor === "cliente" && v.valorTaxa > 0 ? `<br><span class="muted small">cobrado ${brl.format(v.totalCobrado)}</span>` : ""}</td>
            <td class="${lucro < 0 ? "tag-out" : "tag-in"}">${brl.format(lucro)}</td>
            <td>${action}</td>
          </tr>`;
      })
      .join("");
    list.innerHTML = `
      <table>
        <thead><tr><th>Data</th><th>Cliente</th><th>Pagamento</th><th>Itens</th><th>Desconto</th><th>Total</th><th>Lucro</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  list.addEventListener("click", (event) => {
    const { recibo, imprimir } = event.target.dataset;
    const id = recibo || imprimir;
    if (!id) return;
    const venda = cache.vendas.find((x) => x.id === id);
    if (!venda) return;
    try {
      const doc = buildReceipt(venda);
      if (recibo) {
        doc.save(receiptFileName(venda));
        message.textContent = `Recibo nº ${receiptNumber(venda)} gerado.`;
      } else {
        doc.autoPrint();
        window.open(doc.output("bloburl"), "_blank");
        message.textContent = `Recibo nº ${receiptNumber(venda)} aberto para imprimir.`;
      }
    } catch (error) {
      message.textContent = `Não foi possível gerar o recibo. ${error.message || ""}`;
    }
  });

  list.addEventListener("click", async (event) => {
    const id = event.target.dataset.receber;
    if (!id) return;
    const venda = cache.vendas.find((x) => x.id === id);
    if (!venda) return;
    if (!window.confirm(`Marcar como recebida hoje? ${brl.format(venda.total)} entram no caixa.`)) return;
    const { error } = await db.rpc("receber_venda", { p_venda_id: id, p_data: todayISO() });
    if (error) {
      message.textContent = `Não foi possível marcar como recebida. ${error.message}`;
      return;
    }
    message.textContent = "Venda recebida e lançada no caixa.";
    await refreshAll();
  });

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
  form.elements.desconto.addEventListener("input", renderTotal);
  form.elements.taxa.addEventListener("input", renderTotal);
  form.elements.taxaPaga.addEventListener("change", renderTotal);
  form.elements.forma.addEventListener("change", renderTotal);
  form.elements.prazoDias.addEventListener("input", renderPrazo);
  form.elements.data.addEventListener("input", renderPrazo);

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
    if (itens.length === 0 || itens.some((i) => !i.estoque_id || !Number.isInteger(i.quantidade) || i.quantidade < 1 || !(i.preco >= 0))) {
      message.textContent = "Confira peça, quantidade (número inteiro) e preço de cada item.";
      return;
    }
    const prazoDias = Number(form.elements.prazoDias.value);
    if (isPrazo() && !(Number.isInteger(prazoDias) && prazoDias >= 1 && prazoDias <= 365)) {
      message.textContent = "Informe em quantos dias após a compra a cliente vai pagar (de 1 a 365).";
      return;
    }
    const desconto = discountPct();
    if (form.elements.desconto.value !== "" && (num(form.elements.desconto.value) < 0 || num(form.elements.desconto.value) >= 100)) {
      message.textContent = "O desconto precisa estar entre 0% e 99,9%.";
      return;
    }
    if (isCredit() && form.elements.taxa.value !== "" && (num(form.elements.taxa.value) < 0 || num(form.elements.taxa.value) >= 50)) {
      message.textContent = "A taxa da maquininha precisa estar entre 0% e 49,9%.";
      return;
    }
    const total = itens.reduce((sum, i) => sum + i.quantidade * finalPrice(i.preco, desconto), 0);
    if (!(total > 0)) {
      message.textContent = "O total da venda precisa ser maior que zero.";
      return;
    }
    message.textContent = "Registrando...";
    // O id nasce no aparelho: se a venda for reenviada, o banco reconhece e não duplica.
    const params = {
      p_data: dataIso,
      p_cliente_id: clienteSelect.value || null,
      p_forma: form.elements.forma.value,
      p_obs: form.elements.obs.value.trim(),
      p_itens: itens,
      p_parcelas: isCredit() ? Number(parcelasSelect.value) : 1,
      p_desconto: desconto,
      p_taxa: feePct(),
      p_taxa_paga_por: form.elements.taxaPaga.value,
      p_id: window.crypto && crypto.randomUUID ? crypto.randomUUID() : null,
      p_prazo_dias: isPrazo() ? prazoDias : null,
    };
    let error = null;
    if (!navigator.onLine || modoCopia) {
      error = { message: "sem conexao" };
    } else {
      try {
        ({ error } = await db.rpc("registrar_venda", params));
      } catch (falha) {
        error = { message: String((falha && falha.message) || falha) };
      }
    }
    if (error && params.p_id && (!navigator.onLine || modoCopia || ehErroDeRede(error))) {
      // Sem sinal: confere o estoque que o aparelho conhece e guarda a venda na fila.
      const faltando = [...new Set(itens.map((i) => i.estoque_id))].find((id) => {
        const pedido = itens.filter((i) => i.estoque_id === id).reduce((sum, i) => sum + i.quantidade, 0);
        const peca = cache.estoque.find((p) => p.id === id);
        return !peca || peca.quantidade < pedido;
      });
      if (faltando) {
        const peca = cache.estoque.find((p) => p.id === faltando);
        message.textContent = `Estoque insuficiente${peca ? ` de ${peca.nome}: restam ${peca.quantidade} unidade(s)` : ""}.`;
        return;
      }
      fila.adicionar({ id: params.p_id, params, criadoEm: new Date().toISOString(), erro: null });
      aplicarPendentes();
      message.textContent = "Sem internet: venda guardada neste aparelho. Será enviada quando o sinal voltar.";
      form.elements.obs.value = "";
      form.elements.desconto.value = "";
      form.elements.taxa.value = "";
      form.elements.prazoDias.value = "";
      parcelasSelect.value = "1";
      itemsBox.innerHTML = "";
      renderers.forEach((render) => render());
      renderOfflineBar();
      sincronizarVendas();
      return;
    }
    if (error) {
      message.textContent = `Não foi possível registrar a venda. ${error.message}`;
      return;
    }
    message.textContent = isPrazo() ? "Venda a prazo registrada. O valor entra no caixa quando você marcar como recebida." : "Venda registrada.";
    form.elements.obs.value = "";
    form.elements.desconto.value = "";
    form.elements.taxa.value = "";
    form.elements.prazoDias.value = "";
    parcelasSelect.value = "1";
    itemsBox.innerHTML = "";
    await refreshAll();
  });

  renderers.push(renderVendas);
}

// ---------- Financeiro ----------

const FORMAS_PAGAMENTO = ["Dinheiro", "Pix", "Cartão de débito", "Cartão de crédito", "A prazo", "Transferência", "Outro"];
const CATEGORIAS = {
  // "Compra de peças" e "Transporte (viagem)" são lançados sozinhos ao cadastrar peças e viagens.
  saida: ["Energia", "Cápsulas", "Embalagens", "Marketing", "Aluguel", "Outras saídas"],
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
  const profitBox = document.getElementById("finance-profit");

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
    profitBox.innerHTML = profitBlockHtml(profitSummary((d) => monthKey(d) === key), "Custos e lucro do mês");

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
          <td>${escapeHtml(l.categoria)}${l.origem !== "manual" ? ' <span class="badge">automático</span>' : ""}</td>
          <td>${escapeHtml(l.descricao || "—")}</td>
          <td>${escapeHtml(l.forma || "—")}</td>
          <td>${brl.format(l.valor)}</td>
          <td>${l.origem === "manual" ? `<button class="link-btn" data-remove="${l.id}" type="button">Remover</button>` : '<span class="muted small" title="Lançado pelo sistema. Para corrigir, desfaça a venda ou remova a peça ou a viagem.">—</span>'}</td>
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
      ["Data", "Tipo", "Categoria", "Descrição", "Pagamento", "Valor", "Origem"],
      cache.lancamentos.map((l) => [
        formatDate(l.data), l.tipo === "entrada" ? "Entrada" : "Saída", l.categoria, l.descricao, l.forma, csvNumber(l.valor),
        l.origem === "manual" ? "Manual" : "Automático",
      ])
    ),
  estoque: () =>
    downloadCsv(
      "estoque",
      ["Código", "Nome", "Fornecedor", "Categoria", "Tamanho", "Cor", "Quantidade", "Custo do produto", "Custo de transporte", "Custo total", "Preço de venda", "Lucro por peça", "Lucro sobre o custo (%)"],
      cache.estoque.map((p) => [
        p.codigo, p.nome, fornecedorDe(p), categoriaEstoque(p.categoria), p.tamanho, p.cor, p.quantidade,
        csvNumber(p.custoProduto), csvNumber(p.custoTransporte), csvNumber(p.custoTotal), csvNumber(p.precoVenda),
        csvNumber(round2(p.precoVenda - p.custoTotal)), p.custoTotal > 0 ? csvNumber(round2(((p.precoVenda - p.custoTotal) / p.custoTotal) * 100)) : "",
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
      ["Data", "Lojas", "Trajeto", "Paradas", "Km", "Consumo (km/L)", "Combustível", "Preço por litro", "Pedágio", "Peças previstas", "Custo da viagem", "Custo por peça", "Investido (viagem + produtos)", "Já vendido", "Lucro projetado"],
      cache.viagens.map((t) => {
        const s = tripStats(t);
        const paradas = t.trajetoDetalhe && Number.isInteger(t.trajetoDetalhe.paradas) ? t.trajetoDetalhe.paradas : "";
        return [
          formatDate(t.data), lojasTexto(t) === "—" ? "" : lojasTexto(t), t.trajeto, paradas, t.km, csvNumber(t.consumo), t.tipoCombustivel, csvNumber(t.preco),
          csvNumber(t.pedagio), t.pecas, csvNumber(t.total), csvNumber(t.porPeca), csvNumber(round2(s.investido)), csvNumber(round2(s.vendido)), csvNumber(round2(s.lucroProjetado)),
        ];
      })
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
    fornecedores, comprasFornecedor, lucros: profitSummary(inRange),
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
  const l = r.lucros;
  const rows = [
    { section: "Vendas" },
    { label: "Número de vendas", value: r.ativas.length, type: "int" },
    { label: "Peças vendidas", value: t.pecas, type: "int" },
    { label: "Faturamento", value: t.faturamento, type: "money" },
    { label: "Ticket médio", value: t.ticket, type: "money" },
    { section: "Custos e lucro" },
    { label: "Faturamento", value: l.faturamento, type: "money" },
    { label: "Custo das peças vendidas (produto + transporte)", value: l.custoVendido, type: "money" },
    { label: "Lucro bruto", value: l.lucroBruto, type: "money" },
    { label: "Margem bruta (sobre a venda)", value: l.margem / 100, type: "pct" },
    { label: "Lucro sobre o custo", value: l.markup / 100, type: "pct" },
    { label: "Despesas lançadas (energia, cápsulas...)", value: l.despesas, type: "money" },
    { label: "Taxas da maquininha pagas pela loja", value: l.taxas, type: "money" },
    { label: "Lucro líquido", value: l.lucroLiquido, type: "money" },
    { section: "Financeiro (caixa)" },
    { label: "Compras de peças", value: l.comprasPecas, type: "money" },
    { label: "Transporte das viagens", value: l.transporte, type: "money" },
    { label: "Entradas", value: t.entradas, type: "money" },
    { label: "Saídas", value: t.saidas, type: "money" },
    { label: "Resultado do caixa", value: t.resultado, type: "money" },
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
      ${profitBlockHtml(r.lucros, "Custos e lucro do período")}
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

    const unidades = pecas;
    const custoEstoque = cache.estoque.reduce((sum, p) => sum + p.quantidade * p.custoTotal, 0);
    const vendaEstoque = cache.estoque.reduce((sum, p) => sum + p.quantidade * p.precoVenda, 0);

    root.innerHTML = `
      ${profitBlockHtml(profitSummary((d) => monthKey(d) === key), "Custos e lucro do mês")}
      <div class="profit-block">
        <h2>Estoque agora</h2>
        <div class="kpis">
          ${kpiCard("Peças em estoque", String(unidades), { sub: `${cache.estoque.length} item(ns) diferente(s)` })}
          ${kpiCard("Custo do estoque", moneyText(custoEstoque), { sub: "investido nas peças que ainda não venderam", tone: "cost" })}
          ${kpiCard("Valor de venda do estoque", moneyText(vendaEstoque))}
          ${kpiCard("Lucro potencial", moneyText(vendaEstoque - custoEstoque), { sub: custoEstoque > 0 ? `${pct(((vendaEstoque - custoEstoque) / custoEstoque) * 100)} sobre o custo` : "", tone: "profit", negative: vendaEstoque - custoEstoque < 0 })}
          ${kpiCard("Ticket médio do mês", moneyText(ticket))}
        </div>
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
    modoCopia = false;
    marcarLogado(true);
  } catch (error) {
    if (estavaLogado() && carregarCopiaLocal()) {
      renderers.forEach((render) => render());
    } else {
      document.getElementById("login-message").textContent = `Não consegui carregar os dados. ${error.message || ""}`;
      setLoggedIn(false);
    }
  }
  renderOfflineBar();
  sincronizarVendas();
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
    const guardadas = fila.itens().length;
    if (guardadas > 0 && !window.confirm(`Há ${guardadas} venda(s) guardada(s) que ainda não foram enviadas. Elas continuam guardadas, mas só serão enviadas depois que você entrar de novo. Sair mesmo assim?`)) return;
    marcarLogado(false);
    try {
      await db.auth.signOut();
    } catch (error) {
      // Sem internet: a sessão local é limpa mesmo assim ao recarregar.
    }
    window.location.reload();
  });

  db.auth.getSession().then(({ data }) => {
    if (data.session) startApp();
    else if (!navigator.onLine && estavaLogado() && lerCopiaLocal()) startApp();
  });
}

window.addEventListener("hashchange", showRoute);
showRoute();
// Cada tela é iniciada separada: se uma falhar, o resto (principalmente o login) continua funcionando.
[initTrips, initStock, initClients, initVitrine, initFornecedores, initVendas, initFinance, initPainel, initRelatorios, initOffline, initAuth].forEach((iniciar) => {
  try {
    iniciar();
  } catch (error) {
    console.error(`Falha ao iniciar ${iniciar.name}`, error);
  }
});
