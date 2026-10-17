"use strict";

// Vendas sem internet: a venda é guardada neste aparelho e enviada ao banco quando o sinal voltar.
// Este arquivo só cuida da fila e da cópia local dos dados. As regras da venda continuam no banco.

const FILA_KEY = "majen:fila:v1";
const SNAP_KEY = "majen:dados:v1";
const LOGADO_KEY = "majen:logado";

function lerJson(chave) {
  try {
    return JSON.parse(localStorage.getItem(chave));
  } catch (error) {
    return null;
  }
}

function gravarJson(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
    return true;
  } catch (error) {
    return false;
  }
}

// Erro de conexão (sem sinal), diferente de erro do banco (ex.: estoque insuficiente).
function ehErroDeRede(error) {
  if (!error) return false;
  if (error.code) return false;
  return !navigator.onLine || /fetch|network|load failed|timeout|conex/i.test(error.message || "");
}

// Login vencido: a venda continua guardada e só pode ser enviada depois de entrar de novo.
function ehErroDeLogin(error) {
  return !!error && (error.status === 401 || error.code === "PGRST301" || /jwt/i.test(error.message || ""));
}

// Fila de vendas pendentes. `enviar(item)` devolve { error }.
function criarFila({ enviar, estaOnline }) {
  let itens = Array.isArray(lerJson(FILA_KEY)) ? lerJson(FILA_KEY) : [];
  const ouvintes = [];
  let enviando = false;

  const salvar = () => {
    gravarJson(FILA_KEY, itens);
    ouvintes.forEach((fn) => fn());
  };

  async function sincronizar() {
    if (enviando || !estaOnline()) return { enviadas: 0, parou: null };
    enviando = true;
    let enviadas = 0;
    let parou = null;
    try {
      for (const item of itens.slice()) {
        if (item.erro) continue; // com problema: só reenvia quando a pessoa pedir
        const { error } = await enviar(item);
        if (!error || error.code === "23505") {
          itens = itens.filter((x) => x.id !== item.id);
          enviadas += 1;
          salvar();
          continue;
        }
        if (ehErroDeRede(error)) {
          parou = "rede";
          break;
        }
        if (ehErroDeLogin(error)) {
          parou = "login";
          break;
        }
        item.erro = error.message || "Erro ao enviar";
        salvar();
      }
    } finally {
      enviando = false;
    }
    return { enviadas, parou };
  }

  return {
    itens: () => itens.slice(),
    pendentes: () => itens.filter((x) => !x.erro).length,
    comErro: () => itens.filter((x) => x.erro),
    adicionar(item) {
      itens.push(item);
      salvar();
    },
    descartar(id) {
      itens = itens.filter((x) => x.id !== id);
      salvar();
    },
    tentarDeNovo(id) {
      const item = itens.find((x) => x.id === id);
      if (item) item.erro = null;
      salvar();
    },
    aoMudar: (fn) => ouvintes.push(fn),
    sincronizar,
  };
}

// Cópia dos dados para abrir o sistema sem internet. As fotos ficam de fora para não estourar o espaço do aparelho.
function salvarCopiaLocal(cache) {
  const copia = { ...cache, estoque: cache.estoque.map((p) => ({ ...p, foto: "" })), salvoEm: new Date().toISOString() };
  return gravarJson(SNAP_KEY, copia);
}

function lerCopiaLocal() {
  const copia = lerJson(SNAP_KEY);
  return copia && Array.isArray(copia.estoque) && Array.isArray(copia.vendas) ? copia : null;
}

function marcarLogado(sim) {
  try {
    if (sim) localStorage.setItem(LOGADO_KEY, "1");
    else {
      localStorage.removeItem(LOGADO_KEY);
      localStorage.removeItem(SNAP_KEY);
    }
  } catch (error) {
    // Sem armazenamento: o modo sem internet simplesmente não fica disponível.
  }
}

function estavaLogado() {
  try {
    return localStorage.getItem(LOGADO_KEY) === "1";
  } catch (error) {
    return false;
  }
}
