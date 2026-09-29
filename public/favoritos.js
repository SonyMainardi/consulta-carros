// FAVORITOS — os anuncios que a pessoa guardou (ESTADO.md 2-AA, 2026-09-28).
//
// Duas pontas: o coracao em cada linha da tabela, que guarda, e o painel
// "Favoritos" no topo da pagina, que mostra. O painel NAO e do carro da busca:
// junta anuncios de qualquer carro e diz de cada um se continua no ar, se o
// preco mudou desde que foi guardado e de quando e essa informacao.
//
// O estado mora no BANCO (tabela `favoritos`), nao no navegador: e a unica
// coisa pessoal que o sistema guarda, e por isso tem dono (server.js, donoDe).
// Do navegador, so a conveniencia de lembrar se o painel estava aberto.
import { $, api, brl, num, ago, esc, fonteNome, preferencia } from './comum.js';

const chaves = new Set(); // `${source}:${external_id}` de cada favorito
let itens = [];           // a lista completa, para o painel
let carregado = false;    // antes da 1a resposta, "nenhum favorito" seria mentira
let aberto = false;
let erro = null;

const chaveDe = (l) => `${l.source}:${l.external_id}`;

/**
 * O coracao de uma linha da tabela. `modelo` e o carro da tela: vai junto para
 * o favorito saber em que busca foi achado.
 *
 * aria-pressed diz o estado; o rotulo fica fixo ("Favorito"), como pede um
 * botao de alternar. So a dica do mouse muda de verbo.
 */
export function coracao(l, modelo) {
  const on = chaves.has(chaveDe(l));
  return `<button type="button" class="fav${on ? ' on' : ''}" data-chave="${esc(chaveDe(l))}"
            data-modelo="${esc(modelo ?? '')}" aria-pressed="${on}"
            aria-label="Favorito: ${esc(l.title)}" title="${on ? 'tirar dos favoritos' : 'guardar nos favoritos'}"><i class="ic-coracao" aria-hidden="true"></i></button>`;
}

/** Acende e apaga todos os coracoes da pagina, e atualiza as contagens. */
function pintarCoracoes() {
  for (const b of document.querySelectorAll('.fav[data-chave]')) {
    const on = chaves.has(b.dataset.chave);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'tirar dos favoritos' : 'guardar nos favoritos';
  }
  const n = chaves.size;
  const botao = $('#btn-favoritos');
  botao.classList.toggle('tem', n > 0);
  $('#fav-contagem').textContent = String(n);
  $('#fav-total').textContent = n ? String(n) : '';
}

/* ---------------------------------------------------------------------------
   O PAINEL
--------------------------------------------------------------------------- */

const quando = (iso) => {
  const a = ago(iso);
  return a === 'agora' ? 'agora' : `há ${a}`;
};

const dataCurta = (iso) => {
  const d = new Date(iso);
  const opcoes = d.getFullYear() === new Date().getFullYear()
    ? { day: '2-digit', month: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' };
  return d.toLocaleDateString('pt-BR', opcoes);
};

/** Quanto o preco andou desde que foi guardado (0 = igual ou sem como saber). */
function variacao(f) {
  if (f.price == null || f.preco_favoritado == null) return 0;
  const d = Number(f.price) - Number(f.preco_favoritado);
  return Math.abs(d) < 1 ? 0 : d;
}

/**
 * A etiqueta da esquerda. As cores sao as mesmas do "O que mudou": baixou e
 * verde, subiu e saiu do ar sao vermelhos.
 *
 * "Saiu do ar" so quando uma coleta leu a busca INTEIRA e nao o achou — a mesma
 * regra dos eventos. Ausente numa leitura parcial e "nao visto": pode ter so
 * mudado de pagina, e dizer que saiu seria inventar.
 */
function etiqueta(f) {
  if (f.situacao === 'NO_AR') {
    const d = variacao(f);
    if (d < 0) return { classe: 'PRICE_DROP', rotulo: 'baixou', dica: 'no ar, e mais barato do que quando foi guardado' };
    if (d > 0) return { classe: 'PRICE_UP', rotulo: 'subiu', dica: 'no ar, e mais caro do que quando foi guardado' };
    return { classe: 'NO_AR', rotulo: 'no ar', dica: 'estava no ar na última coleta deste carro' };
  }
  if (f.situacao === 'SAIU') {
    return { classe: 'DISAPPEARED', rotulo: 'saiu do ar', dica: 'uma coleta que leu a busca inteira não encontrou este anúncio' };
  }
  if (f.situacao === 'NAO_VISTO') {
    return {
      classe: 'NAO_VISTO', rotulo: 'não visto',
      dica: 'a última coleta leu só parte da busca e ele não estava nela — pode ter só mudado de página, então não dá para dizer que saiu do ar',
    };
  }
  // FORA_DO_CACHE. "Sem notícia" e nao "fora do cache": a etiqueta tem 104px, e
  // quem le quer saber o que isso significa para o carro, nao para o banco.
  return {
    classe: 'NAO_VISTO', rotulo: 'sem notícia',
    dica: 'este anúncio não está mais no banco; o que aparece é como ele estava quando foi guardado',
  };
}

function textoPreco(f) {
  if (f.situacao === 'FORA_DO_CACHE') return `${brl(f.preco_favoritado)} quando guardado`;
  const d = variacao(f);
  if (!d) return `<strong>${brl(f.price)}</strong>`;
  const pct = (d / Number(f.preco_favoritado)) * 100;
  // Mesmo formato do "O que mudou": de → para (%).
  return `${brl(f.preco_favoritado)} → <strong>${brl(f.price)}</strong> (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`;
}

function textoFipe(ratio) {
  if (ratio == null) return null;
  const pct = (Number(ratio) - 1) * 100;
  return `<span class="${pct < 0 ? 'below' : 'above'}">${pct > 0 ? '+' : ''}${pct.toFixed(1)}% FIPE</span>`;
}

function linhaFavorito(f) {
  const e = etiqueta(f);
  const meta = [
    textoPreco(f),
    textoFipe(f.fipe_ratio),
    f.year_model,
    f.km != null ? `${num(f.km)} km` : null,
    esc([f.city, f.uf].filter(Boolean).join('/')),
    esc(fonteNome(f.source)),
    // O carro leva de volta a busca dele — um link comum, com a busca na URL
    // como qualquer outra.
    f.carro ? `<a href="/?modelo=${f.carro.id}" title="buscar ${esc(f.carro.nome)}">${esc(f.carro.nome)}</a>` : null,
    f.visto_em ? `visto ${quando(f.visto_em)}` : null,
    `guardado em ${dataCurta(f.favoritado_em)}`,
  ].filter(Boolean).join(' · ');

  return `<div class="event fav-item">
    <span class="tag ${e.classe}" title="${esc(e.dica)}">${e.rotulo}</span>
    <div class="event-body">
      <a href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.title)}">${esc(f.title)}</a>
      <div class="meta">${meta}</div>
    </div>
    ${coracao(f, f.carro?.id)}
  </div>`;
}

function desenharPainel() {
  const lista = $('#fav-lista');
  $('#fav-nota').hidden = !itens.length;
  if (erro) {
    lista.innerHTML = `<div class="empty">Não deu para carregar os favoritos: ${esc(erro)}</div>`;
    return;
  }
  if (!carregado) {
    lista.innerHTML = '<div class="empty">carregando…</div>';
    return;
  }
  if (!itens.length) {
    lista.innerHTML = '<div class="empty">Nenhum favorito ainda. Clique no coração ao lado de um anúncio para guardá-lo aqui.</div>';
    return;
  }
  lista.innerHTML = itens.map(linhaFavorito).join('');
}

/** Busca a lista no servidor e redesenha coracoes, contagens e painel. */
export async function carregarFavoritos() {
  try {
    itens = await api('/api/favoritos');
    carregado = true;
    erro = null;
  } catch (err) {
    erro = err.message;
    if (aberto) desenharPainel();
    return;
  }
  chaves.clear();
  for (const f of itens) chaves.add(f.chave);
  if (aberto) desenharPainel();
  pintarCoracoes();
}

function mostrarPainel(abrir) {
  aberto = abrir;
  $('#favoritos').hidden = !abrir;
  const botao = $('#btn-favoritos');
  botao.classList.toggle('on', abrir);
  botao.setAttribute('aria-expanded', String(abrir));
  preferencia.gravar('favoritos-aberto', abrir);
}

/* ---------------------------------------------------------------------------
   GUARDAR E TIRAR
--------------------------------------------------------------------------- */

async function alternar(btn) {
  const chave = btn.dataset.chave;
  const i = chave.indexOf(':');
  const [source, externalId] = [chave.slice(0, i), chave.slice(i + 1)];
  const guardar = !chaves.has(chave);

  btn.disabled = true;
  try {
    await api(`/api/favoritos/${encodeURIComponent(source)}/${encodeURIComponent(externalId)}`, {
      metodo: 'PUT',
      corpo: { favorito: guardar, modelo: Number(btn.dataset.modelo) || null },
    });
    if (guardar) chaves.add(chave); else chaves.delete(chave);
    pintarCoracoes();

    const linha = btn.closest('.fav-item');
    if (linha) {
      // Tirado pelo proprio painel: a linha fica, apagada, ate a proxima carga.
      // Um clique errado se desfaz no mesmo lugar, sem ter de achar o anuncio
      // de novo na busca.
      linha.classList.toggle('removido', !guardar);
    } else if (aberto) {
      carregarFavoritos();
    }
  } catch (err) {
    btn.title = `não deu: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

export function iniciarFavoritos() {
  $('#btn-favoritos').addEventListener('click', () => {
    mostrarPainel(!aberto);
    if (!aberto) return;
    // Desenha na hora com o que ja tem e atualiza por tras — abrir o painel
    // nao pode esperar a rede.
    desenharPainel();
    carregarFavoritos();
    $('#favoritos').scrollIntoView({ block: 'nearest' });
  });
  $('#fav-fechar').addEventListener('click', () => mostrarPainel(false));

  // Delegado no documento: os coracoes nascem a cada carga da tabela e do
  // painel, e um handler por botao se perderia a cada redesenho.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.fav[data-chave]');
    if (b && !b.disabled) alternar(b);
  });

  mostrarPainel(preferencia.ler('favoritos-aberto', false) === true);
  if (aberto) desenharPainel();
  carregarFavoritos();
}
