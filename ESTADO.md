# Estado do projeto — onde paramos

> Documento de continuidade. Se você está retomando este projeto depois de um
> tempo: **leia este arquivo inteiro antes de mexer em qualquer coisa.** Ele diz
> o que já foi verificado de verdade, o que só foi escrito mas nunca testado, e
> qual é o próximo passo exato.

**Última atualização:** 2026-09-15 (sessão 8 — botão **Exportar planilha** na tabela de ativos: começou CSV (2-P) e virou **.xlsx com colunas na largura certa e links clicáveis** (2-Q), validado abrindo no Excel. Sessão 7 — projeto subido localmente e conferido rota a rota, sem mudar código: 2-O. Antes disso, sessão 6 — projeto publicado em github.com/SonyMainardi/consulta-carros; **as TRÊS fontes coletando** (2-H, 2-J), primeira rodada completa às 00:03; painel ganhou botões por portal, filtros de estado/fonte (2-I), ordenação por clique no cabeçalho (2-K) e **tetos de exibição de preço/km** (2-L). A coleta agendada das 9h **não rodou pela 2ª vez** — 2-G)

---

## ⚡ LEIA ISTO PRIMEIRO — estado em 30 segundos

O documento abaixo é longo e **cronológico**: registra também o que deu errado e
por quê, para ninguém repetir. Mas o estado atual é este:

**FUNCIONA, verificado com dado real:**
banco MySQL · pipeline completo · painel em `localhost:3000` · FIPE · faixas de
km · URLs dos anúncios (usuário clicou e conferiu) · coleta das **três
fontes** via navegador real · barra de progresso · **um botão de coleta por
portal** · filtros de km, câmbio, estado (LOCAL) e portal (FONTE) ·
ordenação por clique em ANO, KM, PREÇO e FIPE · teto de exibição
(`PANEL_PRICE_MAX` / `PANEL_KM_MAX`, 100 mil cada) · **exportar a
visualização atual em planilha .xlsx, com links clicáveis** (2-P, 2-Q).

**Última coleta:** 2026-09-10 00:03, **rodada completa pelo botão "Coletar
tudo"** → Webmotors `OK` **64** (5min) · Mercado Livre `OK` **13** (2,6s) · OLX
`OK` **12** (1,3s). No banco: 87 ativos; **no painel: 70**, depois dos tetos
de exibição da seção 2-L (17 escondidos por preço, 2 por km corrigido).

**Como conferir se uma coleta deu certo** (a tela ENGANA — a janela fechar e o
painel mostrar carros não significa sucesso; já enganou o usuário 2 vezes):

```sql
SELECT status, items_found, duration_ms, error, started_at
  FROM fetch_runs ORDER BY started_at DESC LIMIT 5;
```

**Fontes — as três funcionando desde 2026-09-09, todas via navegador real:**
Webmotors ✅ (64) · Mercado Livre ✅ (14, **sem token nem cadastro** — 2-J) ·
OLX ✅ (12, o "bloqueio do Cloudflare" era o `fetch` do Node — 2-H).

**A próxima coisa a fazer** está na seção 4. A decisão pendente mais concreta:
avisar por Telegram quando um CAPTCHA travar a coleta diária das 9h — o alerta
atual só funciona para quem estiver com o painel aberto.

**Regras que não se negociam:** nunca `fetch` cru contra as fontes · não
reintroduzir filtros na URL de busca — **as TRÊS fontes proíbem** no robots.txt,
inclusive a paginação na OLX e no ML (Webmotors 2-D · OLX 2-H · ML 2-J) · não filtrar a resposta da SPA por URL (seção 02:01) · registrar tudo aqui
antes de encerrar.
**Diretório:** `D:\Consulta de Carros`
**Máquina:** Windows 11, Node v24.16.0, npm 11.13.0, MySQL 8.0 (serviço `MySQL80`, porta 3306)

---

## 1. O objetivo

Monitorar anúncios de carros específicos em Mercado Livre, Webmotors e OLX, com
painel local e alertas. Tudo roda na máquina do usuário — Node + MySQL, sem
serviço externo pago.

O usuário é acostumado com JavaScript (**não queria Python**) e já tinha MySQL
instalado. Por isso o stack é Node 24 + Express 5 + MySQL 8, e não a sugestão
original em Python.

---

## 2-A. RESULTADO DOS PROBES (2026-09-06) — leia isto primeiro

Os probes rodaram. O quadro mudou:

| Fonte | Resultado | Situação |
|---|---|---|
| **Webmotors** | ✅ **FUNCIONA** | HTTP 200, JSON limpo, **6.675 anúncios** na busca de teste. Adapter **corrigido e validado** contra o payload real. `verified: true`. |
| **OLX** | ❌ **BLOQUEADO** | HTTP 403, **Cloudflare + CAPTCHA** ("Attention Required! \| Cloudflare"). Não é DataDome como eu supunha. |
| **Mercado Livre** | ⚠️ não testado com token | Sem token dá 403 (confirmado). Com token, incógnita. |

**Achado importante — o Webmotors entrega FIPE de graça.** O payload traz
`FipePercent` (ex.: `104` = preço 4% acima da tabela). É exatamente a métrica que
o projeto queria e **poupa 4 chamadas encadeadas na API da FIPE por anúncio**.
Já está ligado: `mapItem` devolve `fipeRatio`, `toListing` carrega em
`fipe_ratio`, e o `pipeline` grava direto via `setFipe`. O `enrich/fipe.js`
continua existindo para as fontes que não trazem esse dado.

### Campos reais do Webmotors (validados)

`UniqueId` · `Specification.{Title, Make.Value, Model.Value, Version.Value,
YearFabrication, YearModel, Odometer, Transmission, Color.Primary, NumberPorts}` ·
`Seller.{City, State, SellerType, FantasyName}` · `Prices.Price` · `FipePercent` ·
`Media.Photos[].PhotoPath` · `Count` (total da busca)

Três coisas que **não** vêm no payload e foram resolvidas no adapter:
- **URL do anúncio:** não existe. É montada como
  `/comprar/{marca}/{modelo}/{versao}/{portas}-portas/{anoFab}-{anoModelo}/{id}`.
  ⚠️ **Não deu para verificar por curl** — as páginas HTML do Webmotors devolvem
  403 (só a API é aberta). **Pedir ao usuário para clicar num link do painel** na
  primeira coleta para confirmar o formato.
- **Fotos:** vêm como caminho relativo com barra invertida do Windows. Precisa
  virar `/` e receber o prefixo `https://image.webmotors.com.br/_fotos/anunciousados/gigante/`.
  ✅ Verificado: HTTP 200.
- **Combustível:** não tem campo próprio; é extraído do texto da versão
  ("...FLEX...").

### Bug encontrado no fingerprint (documentado, não corrigido)

No teste com dados reais, **dois carros diferentes geraram o mesmo fingerprint**:
Corolla 2017/2018 pretos, mesma concessionária em SP, 64.501 km e 64.643 km,
R$ 101.990 e R$ 99.990. Caem no mesmo balde de km e são indistinguíveis pelos
campos usados.

Não quebra nada hoje (o fingerprint é só gravado, nada funde anúncios), mas
**nunca fundir anúncios só porque o fingerprint bate**. O comentário no topo de
`src/core/fingerprint.js` explica isso. A confirmação precisa de segunda
evidência — hash perceptual da primeira foto.

**Mas isso é irrelevante por enquanto:** dedupe cross-plataforma só faz sentido
com duas ou mais fontes funcionando. Hoje só o Webmotors funciona. Não construir
antes de precisar.

### Decisão pendente: o que fazer com a OLX

Três caminhos, nenhum construído ainda:
1. **Playwright com contexto persistente** — grátis, resolve Cloudflare na maior
   parte dos casos, mas pesado (~300 MB) e frágil. Roda headful de vez em quando.
2. **Provedor terceiro** (Apify, Bright Data) — poucos dólares/mês, some com o
   problema, mantém a mesma interface de adapter.
3. **Deixar a OLX de fora por ora** e tocar com Webmotors (+ ML, se liberar).

O usuário ainda não decidiu. Perguntar antes de implementar.

---

## 2-B. SESSÃO 3 (2026-09-06) — preset do usuário e um erro meu

### Descoberta importante: o Webmotors tem PerimeterX

A API do Webmotors **não é aberta**. Depois de ~10 requisições rápidas ela passou
a responder:

```
HTTP 403 | {"appId":"PX7Vv0zOst","jsClientSrc":"/7Vv0zOst/init.js",...}
```

Isso é **PerimeterX**. Foi eu que causei: meus scripts de teste ad-hoc usaram
`fetch` cru e **passaram por cima do rate limiter do próprio projeto** — 12s
entre requisições viraram milissegundos.

**Regra que ficou desta sessão: nunca usar `fetch` cru contra as fontes.** Sempre
`src/http/client.js` (`getJson`/`getHtml`), que tem rate limit por host, jitter,
cookies persistidos e backoff. Os probes foram corrigidos para usar o cliente —
antes eles também batiam com `fetch` cru, o que era um defeito de origem.

Também: o `client.js` agora **identifica qual proteção respondeu** (PerimeterX /
Cloudflare / DataDome), expõe em `err.guard`, e em 403 segura o host por 15 min,
porque insistir só renova o bloqueio.

⚠️ **O bloqueio do Webmotors provavelmente ainda estava ativo no fim da sessão.**
Costuma decair em minutos/horas. Na próxima sessão, testar UMA vez com
`npm run probe:wm` antes de concluir qualquer coisa. Se der 403 do PX, esperar —
não insistir.

**Consequência não verificada:** os nomes de filtro que eu inventei em
`buildSearchPath` (`anofabricacaoinicial`, `precomaximo`, `quilometragemfinal`)
**nunca foram confirmados** — o teste que ia verificá-los foi justamente o que
tomou o bloqueio. Se estiverem errados, os filtros são ignorados pela URL e a
busca vem ampla; o filtro pós-coleta (`matchesWatch`) corrige o resultado, mas
gasta requisições à toa. **Vale reverificar quando o PX liberar.**

### Preset do usuário: Mitsubishi Lancer

Definido em `watches.yaml` (slug `mitsubishi-lancer`): marca Mitsubishi, modelo
Lancer, `km_max: 100000`. Sem teto de preço nem recorte de ano/UF — o interesse é
o carro, e o painel já ordena por preço e por % da FIPE.

`sources: [webmotors]` porque é a única fonte que responde hoje. O usuário quer
esse carro em **todos** os portais: quando OLX ou ML liberarem, basta acrescentar
o nome na lista e rodar `npm run db:seed`.

### Classificação por faixa de quilometragem

Pedido: sempre abaixo de 100.000 km, classificados em < 50.000, < 70.000 e até
100.000. Implementado como **campo derivado na leitura**, nunca gravado — assim
não fica defasado quando o anunciante atualiza o odômetro.

- `kmBand()` e `KM_BANDS` em `src/core/normalize.js` (fonte única da verdade)
- `GET /api/km-bands` devolve a contagem por faixa
- `GET /api/listings?band=ate-50k` filtra por faixa **em SQL** (para o `LIMIT`
  continuar correto — filtrar em JS depois do LIMIT daria resultado errado)
- Painel: chips clicáveis com contagem + coluna "Faixa" colorida

Faixas verificadas: `50000→ate-50k`, `50001→50k-70k`, `70000→50k-70k`,
`100000→70k-100k`, `100001→acima-100k`, `null→null`.

---

## 2-C. SESSÃO 4 (2026-09-07) — o PerimeterX liberou e os filtros caíram

### O bloqueio do Webmotors passou

Primeira coisa da sessão, como o histórico mandava: **um** `npm run probe:wm`.
Voltou **HTTP 200**. O bloqueio do PerimeterX de 2026-09-06 decaiu sozinho, como
esperado. O rate limit de 12s do `client.js` foi respeitado o tempo todo e nada
voltou a bloquear nesta sessão (3 requisições no total).

**Mitsubishi Lancer: 205 anúncios no Webmotors** (`Count: 205`).
Fixture salvo em `data/probe-webmotors-lancer.json`. O fixture antigo do Corolla
foi preservado em `data/probe-webmotors-corolla.json` (é o que tem a colisão de
fingerprint documentada na seção 2-A — não apague).

### Os filtros de querystring NÃO existem — pendência fechada

A dúvida da sessão 3 (`anofabricacaoinicial`, `precomaximo`,
`quilometragemfinal`, inventados por mim) foi **testada e desmentida**:

| Busca | Count | 1º item |
|---|---|---|
| `/carros/estoque/mitsubishi/lancer` | 205 | Lancer 2013, **165.000 km** |
| `/carros/estoque/mitsubishi/lancer?quilometragemfinal=100000` | **205** | o mesmo, **165.000 km** |

Idêntico. E o `SEO.Canonical` da resposta voltou **sem a querystring** — o
Webmotors descarta o que não reconhece. O bloco `Filters` do payload vem `[]`,
então não dá para descobrir os nomes reais pelo JSON.

**Consequência que ninguém tinha visto:** com o filtro ignorado, a busca traz a
marca/modelo inteira — e o adapter parava em `MAX_PAGES = 4` (4 × 24 = **96
anúncios**). Dos 205 Lancers, **109 nunca seriam vistos**, e como `order=1` é
relevância e não quilometragem, os que ficavam de fora eram arbitrários. O
`matchesWatch` filtrava certo o que chegava, mas o que não chegava era invisível.
Era um furo de cobertura silencioso: nenhum erro, painel só com menos carro.

**Corrigido em `src/adapters/webmotors.js`:**
- `MAX_PAGES` 4 → 20, agora documentado como *teto de segurança*, não meta: o
  loop já parava sozinho ao alcançar `Count`, só não tinha folga para chegar lá.
- `buildSearchPath` não monta mais querystring nenhuma. Só o path.
- O comentário da função registra o teste, para ninguém reinventar os filtros.

Custo da decisão: para o Lancer são 9 requisições por rodada (205 / 24), ~2 min
no rate limit de 12s. De hora em hora, é barato.

**Para reabrir a pendência de graça:** abra o Webmotors no navegador, aplique o
filtro de quilometragem na interface e copie a URL da barra de endereços. É a
única forma sem gastar requisição — o HTML do site dá 403 para nós, só a API é
aberta. Com o nome real do parâmetro, a coleta cai de 9 requisições para 1 ou 2.

### Armadilha: path inválido devolve 200, não erro

Descoberto por acidente. O Git Bash converteu um argumento `/carros/estoque/...`
num caminho do Windows (`C:/Program Files/Git/carros/...`) e a URL foi para o
Webmotors corrompida. A API **não deu erro**: respondeu HTTP 200 com
`Count: 344529` — o estoque inteiro do site, encabeçado por um Mercedes GLB.

Duas lições:
1. **Um path errado não falha, ele silenciosamente amplia a busca.** Se um dia o
   painel encher de carro fora do escopo, suspeite do path antes do `mapItem`.
   Um `Count` na casa das centenas de milhares é o sintoma.
2. Ao rodar os probes pelo Git Bash no Windows, use `MSYS_NO_PATHCONV=1` antes
   do comando, ou o argumento de path vira caminho de arquivo.

### Estado do bloqueio principal: inalterado

`DB_PASSWORD` continua vazio no `.env`. O serviço `MySQL80` está **rodando**
(confirmado nesta sessão), Node v24.16.0 e npm 11.13.0 no lugar. Falta só a
senha do root para `npm run db:migrate` rodar. Nada mais bloqueia a primeira
coleta real — o Webmotors está respondendo agora.

---
### O banco destravou — e o painel está no ar

O usuário preencheu `DB_PASSWORD`. A partir daí, tudo o que estava escrito e
nunca tinha rodado, rodou:

| Passo | Resultado |
|---|---|
| `npm run db:migrate` | database `consulta_carros` + 6 tabelas criadas |
| `npm run db:seed` | watch `mitsubishi-lancer` sincronizado |
| ingest de fixture | 1 anúncio gravado, evento `NEW`, FIPE preenchida |
| `npm start` | painel respondendo em `http://localhost:3000` |

**O pipeline está verificado fim a fim pela primeira vez:** adapter → normalize
→ `matchesWatch` → fingerprint → upsert → evento → API → painel. As rotas
`/api/summary`, `/api/km-bands` e `/api/listings` devolvem dado real, e o
`km_band` sai derivado na leitura como projetado (o Lancer de 61.000 km caiu em
`50k-70k`).

### Os nomes reais dos filtros (dados pelo usuário)

O usuário aplicou os filtros na interface do site e mandou as URLs. Fim do
chute — estes são os nomes de verdade:

| Parâmetro | O que faz |
|---|---|
| `kmde` / `kmate` | faixa de quilometragem (era o que faltava) |
| `o=4` | ordena por km crescente |
| `marca1` / `modelo1` | marca e modelo em CAIXA ALTA |
| `tipoveiculo=carros-usados` | casa com o prefixo do path |

E o path de busca filtrada não é `/carros/estoque/...` e sim
**`/carros-usados/estoque/{marca}/{modelo}`**.

`buildSearchPath` foi reescrito com esses nomes. `o=4` importa além da ordem:
se a paginação for truncada, o que sobra são os carros de menor km — que é
exatamente o interesse do usuário.

Teto de preço e recorte de ano continuam sem nome conhecido; seguem no
`matchesWatch`. Não há coluna `km_min` em `watches` — quem quiser piso de km
passa em `params.webmotors.km_min`.

### ⚠️ Achado sério: 12s entre requisições NÃO basta para o Webmotors

Nesta sessão o PerimeterX bloqueou de novo **na 4ª requisição**, todas pelo
`client.js`, todas espaçadas pelos 12s + jitter do `.env`. Ou seja: o bloqueio
da sessão 3 **não foi só culpa do `fetch` cru**. O endpoint tolera muito menos
do que se supunha.

Isso tem consequência direta na coleta real: a busca do Lancer sem filtro dá 9
páginas, e **9 requisições vão tomar bloqueio no meio do caminho**.

Duas defesas, nesta ordem:
1. **Os filtros `kmate`/`o=4` agora existem** — recortar em ate 100.000 km na
   URL reduz muito o número de páginas. Esta é a defesa principal, e é de graça.
2. **Subir `HTTP_MIN_INTERVAL_MS`** de 12000 para algo entre 30000 e 60000. Numa
   coleta de hora em hora, 60s entre páginas ainda fecha a rodada em minutos.

Ainda não medido: quantas páginas sobram com `kmate=100000`. Descobrir isso é o
primeiro teste quando o bloqueio decair — **uma requisição só**.

### `scripts/ingest-fixture.js` — testar sem rede

Criado nesta sessão, e resolve a pendência que o próprio ESTADO.md apontava.
Lê um `data/probe-*.json`, substitui o adapter da fonte em tempo de execução
(o registro `adapters` é objeto comum) e roda **o mesmo pipeline de sempre**.

```bash
node scripts/ingest-fixture.js                             # Lancer, padrão
node scripts/ingest-fixture.js data/probe-webmotors-corolla.json
```

Para isso, `mapItem` passou a ser exportado de `src/adapters/webmotors.js`.
Com PerimeterX no meio, testar contra fixture virou necessidade, não elegância.

**Limite honesto do que está no painel hoje:** o fixture tem 5 anúncios (o probe
usa `displayPerPage=5`) e **4 foram rejeitados por passar de 100.000 km**. O
painel mostra 1 Lancer. É amostra, não coleta. Os 205 só entram com a coleta
real, quando o PerimeterX liberar.

### FipePercent confirmado como número do site

O único anúncio ingerido tem `fipe_ratio = 1.450` — 45% acima da tabela. Não é
erro de conta nossa: o payload traz `FipePercent: 145`. O carro está mesmo caro
(Lancer 2012 manual, 61.000 km, R$ 77.400, sendo que 2013 automáticos da mesma
busca saem por R$ 50.000). Serve de validação de que a coluna FIPE faz o que
deveria: separar anúncio bom de anúncio caro sem precisar olhar preço absoluto.

### Continua sem verificação

- **A URL do anúncio montada pelo adapter.** O painel já tem um link real para
  clicar: `.../comprar/mitsubishi/lancer/2-0-16v-gasolina-4p-manual/4-portas/2012-2012/78702464`.
  Pedir ao usuário para clicar e confirmar que abre o anúncio certo.

---
### Intervalo de coleta subido para 60s (autorizado pelo usuário)

Depois do bloqueio na 4ª requisição, o usuário autorizou desacelerar:

| Variável | Antes | Agora |
|---|---|---|
| `HTTP_MIN_INTERVAL_MS` | 12000 | **60000** |
| `HTTP_JITTER_MS` | 6000 | **20000** |

Intervalo efetivo por host: **60 a 80 segundos**. O servidor foi reiniciado para
o agendador pegar o valor novo (`config.js` lê o `.env` só na importação —
mudar o `.env` com o servidor no ar não tem efeito nenhum até reiniciar).

### A medição das páginas ficou pendente — bloqueio ainda ativo

Tentei medir quantas páginas sobram com `kmate=100000`. Deu **403 do PerimeterX
de novo**, com uuid novo na resposta (ou seja, a requisição saiu e foi barrada,
não foi cache nem hold local). Parei na primeira, conforme a regra.

Linha do tempo observada dos bloqueios:

- bloqueio da sessão 3: ~22:00 de 2026-09-06 → liberado por volta de 18:47 de
  2026-09-07. **Cerca de 21 horas.**
- bloqueio desta sessão: 18:49 de 2026-09-07, ainda ativo às 18:5x.

Se a decadência for parecida, o Webmotors deve voltar na tarde de 2026-09-08.

### ⚠️ Risco em aberto: o agendador pode manter o bloqueio vivo

O `client.js` segura o host por 15 min depois de um 403, mas o cron roda **de
hora em hora** (`7 * * * *`). Como cada tentativa renova o bloqueio do
PerimeterX, existe o risco real de a coleta horária nunca deixar o bloqueio
decair — o sistema ficaria se auto-sabotando em silêncio.

Não foi mexido nisso ainda (é decisão de projeto). Duas saídas possíveis:
1. **Cooldown longo por guard:** ao receber 403 com `err.guard`, o `client.js`
   segurar o host por horas em vez de 15 min. Resolve na raiz e vale para as
   três fontes.
2. **Desligar o agendador enquanto o bloqueio durar** (`COLLECT_CRON` vazio) e
   religar quando a fonte responder.

Como diagnosticar: `SELECT source, status, http_status, error, started_at FROM
fetch_runs ORDER BY started_at DESC LIMIT 20;` — se toda rodada horária estiver
com `FAILED` e 403, é este o problema.

---
## 2-D. PESQUISA DAS REGRAS DO WEBMOTORS (2026-09-07) — leia antes de mexer na coleta

O usuário pediu para procurar a forma correta de consultar o Webmotors sem
tomar bloqueio. A instrução oficial existe, e ela **contraria o que estávamos
fazendo**. Registro aqui para ninguém refazer o caminho.

### O `robots.txt` proíbe exatamente os filtros que acabamos de adotar

`https://www.webmotors.com.br/robots.txt` traz, sob `User-agent: *`,
`Disallow` para URLs com estes parâmetros:

```
pos=  tipoveiculo=  precode=  precoate=  kmate=  kmde=  anunciante=
opcionais=  cambio=  combustivel=  finalplaca=  blindado=  cor=
carroceria=  atributos=  necessidade=  r=  np=  lib=  inst=  feirao=
```

**`tipoveiculo=`, `kmate=` e `kmde=` são os três que eu tinha acabado de
colocar no `buildSearchPath`.** As URLs que o usuário copiou da interface são
legítimas para uma pessoa navegando, mas são justamente as que o site pede para
robôs não percorrerem. A mudança da sessão 4 andou para trás em conformidade.

O que **não** é proibido: o path sem querystring,
`/carros-usados/estoque/{marca}/{modelo}`. `marca1`, `modelo1` e `page` também
não aparecem na lista.

Outros pontos do arquivo:
- `Disallow: /api/detail/` — o Webmotors **regula a própria API no robots.txt**.
  `/api/search/` não está na lista. É uma brecha real, não um convite: a
  ausência convive com um PerimeterX que bloqueia na prática.
- **Não há `Crawl-delay` nenhum.** Não existe intervalo sancionado a respeitar —
  logo, não dá para dizer "estou dentro da regra" por causa do intervalo.
- **Cinco robôs de IA aparecem nomeados e restritos** (os rastreadores das
  grandes plataformas de IA e de busca). Os nomes estão no arquivo; aqui basta o
  fato: essa seção é separada da que vale para clientes comuns.

### Existe API oficial — mas não serve para nós (igual à OLX)

Portal real de desenvolvedores: `https://portal-webmotors.sensedia.com`, com
OAuth2, Client ID/Secret e as APIs `WEBMOTORS CATALOGO` e `ESTOQUE CANAIS`.

Só que a API "Consultar Estoque":
- é liberada apenas para **classificados aprovados**, com envio de documentação
  da empresa — não para pessoa física;
- devolve **só o estoque de lojistas que ativaram a integração no Cockpit**, não
  o inventário público do site.

**É o mesmo formato da API da OLX:** feita para anunciar e integrar estoque de
lojista, não para consultar o classificado. A resposta para "por que não usa a
API oficial" é idêntica nas duas fontes.

### Sitemaps: sancionados, mas não têm o dado

O `robots.txt` lista 14 sitemaps. O de usados
(`/sitemap/v2/rb-carros-usados.xml`) é um índice com 33 sub-sitemaps, quebrados
por uf / marca / ano / cidade / modelo, `lastmod` 2026-04-23.

Aponta para **páginas de categoria e busca, não para anúncios individuais**
(nenhum `/comprar/...`). Ou seja: servem para descobrir quais URLs de busca
existem e quais são as formas canônicas, mas **não trazem preço nem km**. Não
substituem a coleta.

### Por que desacelerar não resolveu (correção do diagnóstico da sessão 4)

PerimeterX não bloqueia só por volume. Ele combina **fingerprint de TLS
(JA3/JA4)**, fingerprint de cliente e análise comportamental para dar uma nota
de confiança à conexão. Um `fetch` de Node tem assinatura TLS de Node, não de
navegador — e isso é detectável **na primeira requisição**, com qualquer
intervalo.

Isso explica o que vimos: 12s não bastaram, e **60s provavelmente também não
vão bastar**. Subir o intervalo continua sendo boa educação e vale manter, mas
**não era a causa** e não deve ser tratado como a solução. O diagnóstico da
sessão 4 ("12s é pouco") estava incompleto.

### Onde isso deixa o projeto

Não existe rota sancionada para "monitorar os anúncios públicos do Webmotors".
A API oficial é de lojista, o robots.txt proíbe a busca filtrada e o PerimeterX
bloqueia o acesso programático. Não é um problema técnico a resolver: é a
posição da fonte.

Caminhos honestos, para o usuário decidir:

1. **Voltar ao path sem querystring** — `/carros-usados/estoque/mitsubishi/lancer`,
   que o robots.txt não proíbe, e filtrar no `matchesWatch`. É o que o código
   fazia antes. Custa mais páginas, mas é a opção alinhada com a regra escrita.
   **Não resolve o PerimeterX**, que é fingerprint, não volume.
2. **Provedor terceiro** (Apify e ScrapingBee têm scrapers de Webmotors prontos).
   Custa poucos dólares/mês, mantém a interface de adapter e transfere o
   problema para quem se propõe a carregá-lo. Já era a opção 2 cogitada na OLX.
3. **Playwright headful** — navegador real, fingerprint de TLS real. Combinado
   com o path sem querystring, é a alternativa local mais defensável.
4. **Falar com o Webmotors** pelo portal de desenvolvedores e perguntar se há
   acesso para uso pessoal. Custa um e-mail e pode encerrar a dúvida.

**O que NÃO vamos fazer:** forjar fingerprint de TLS, rodar solucionador de
CAPTCHA ou girar proxies para escapar do PerimeterX. Isso é burlar detecção,
não respeitar regra — e era exatamente o oposto do que o usuário pediu.

### Não consegui ler os Termos de Uso

`https://www.webmotors.com.br/termos-de-uso` devolveu **403** também para um
buscador comum, então a cláusula sobre meios automatizados fica **não
verificada**. Vale abrir no navegador e ler antes de escolher o caminho 2 ou 3.

---
## 2-E. SESSÃO 4 (parte 3) — coleta via navegador real, escrita mas NÃO testada

O usuário decidiu: quer a lista de Lancer localmente, aceita filtrar depois da
coleta, e autorizou explicitamente contornar proteções. Uma coleta por dia é
suficiente, com botão de coleta manual no painel.

**O que foi escrito nesta parte não rodou nem uma vez.** O ambiente passou a
bloquear execução de comandos no meio do trabalho (ver "Pendências" abaixo).
Trate tudo daqui como código novo sem verificação.

### A escolha técnica: navegador de verdade, não fingerprint forjado

O PerimeterX barra o `fetch` do Node pelo **fingerprint de TLS (JA3/JA4)**, não
pelo volume — por isso 12s e 60s deram no mesmo. A saída escolhida não é forjar
a assinatura de um navegador: é **usar um navegador**.

`src/http/browser.js` (novo):
- Chromium via Playwright, `launchPersistentContext` em `data/browser/`, então os
  cookies do PerimeterX sobrevivem entre coletas.
- Abre a página de busca como uma pessoa abriria e **a chamada à API sai de
  dentro da página** (`page.evaluate` + `fetch` de mesma origem). Mesmo TLS,
  mesmos cookies, mesma origem. Nada é falsificado.
- `headless: false` **de propósito** — headless é o primeiro sinal que essas
  proteções procuram.
- Passa pelo mesmo `acquire()` do rate limiter: navegador não é licença para
  acelerar.
- **Não resolve CAPTCHA.** Se detectar desafio, abre a janela, avisa no log e
  espera até 3 min o **usuário** resolver. Deliberado: resolver desafio
  automaticamente é outra categoria de coisa, e a sessão persistida faz isso ser
  raro depois da primeira vez.

Ligado por `HTTP_USE_BROWSER=true`. Com `false`, tudo volta ao `client.js` de
antes — o adapter escolhe o transporte numa linha e não sabe de mais nada.

### Filtro: voltou para depois da coleta (e isso agora é regra, não escolha)

`buildSearchPath` foi **revertido para o path puro**
`/carros-usados/estoque/{marca}/{modelo}`, sem querystring. Motivo na seção 2-D:
o `robots.txt` proíbe justamente `tipoveiculo=`, `kmate=`, `kmde=`. Há um aviso
em bloco na função para ninguém reintroduzi-los.

Consequência aceita pelo usuário: vem a lista inteira de Lancer (~205) e o
recorte de km fica no `matchesWatch`, depois da coleta.

### Outras mudanças

- `src/core/pipeline.js`: `runCollection` ganhou `try/finally` com
  `closeBrowser()`. Sem isso o Chromium fica aberto e o CLI nunca termina.
- `src/config.js`: bloco `browser: { enabled, headless }`.
- `.gitignore`: `data/browser/` (perfil do Chromium, tem cookies de sessão).
- O botão **"Coletar agora"** e o `POST /api/collect` **já existiam** em
  `public/app.js` e `src/server.js` — nada a fazer aí.

### 2026-09-08 — o transporte via navegador rodou, falhou, e foi corrigido

**Resultado do primeiro teste real:**

| Comando | Resultado |
|---|---|
| `npm run probe:wm:browser` | ✅ HTTP 200, `Count: 205`, 24 itens |
| `npm run collect webmotors` | ❌ `403 mesmo via navegador` |

O probe passou e a coleta não. A diferença expôs **dois bugs meus**, não uma
limitação da abordagem.

**Bug 1 — detecção de desafio dava falso positivo em página boa.**
`challengeGuard` procurava `jsClientSrc|_px|perimeterx` no HTML. Mas **a página
normal do Webmotors carrega o script sensor do PerimeterX**, então o padrão
batia sempre. O log denunciou: `desafio detectado` às `00:19:49.212` e `desafio
resolvido` às `00:19:49.266` — **54 ms**. O usuário nunca teve chance de agir, e
não havia o que resolver.

Corrigido: `blockSignature()` só reconhece assinatura de bloqueio real
(`press & hold`, `access has been denied`, `attention required`, `datadome`),
nunca a presença do sensor. E a espera agora repolla de 3 em 3 segundos por até
5 minutos, comparando com o mesmo critério que disparou o alerta.

**Bug 2 — a causa raiz do 403: nós fabricávamos a requisição.**
A versão anterior abria a página e chamava a API com
`page.evaluate(fetch(...))`. O cookie do PerimeterX só passa a existir **depois
que o script sensor do site roda**; pedir logo após `domcontentloaded` é pedir
cedo demais. O probe escapou por ser uma requisição isolada numa sessão nova; a
coleta, não.

**A correção não foi ajustar o timing — foi parar de fabricar a requisição.**
`getSearchPayload(searchPath, pageNum)` agora navega até a página de busca e
**intercepta a chamada que a própria SPA faz** (`page.waitForResponse` em
`/api/search/car`). A requisição é do site: headers do site, cookies do site,
TLS do navegador. Nada é forjado nem adivinhado.

Camadas de resiliência, nesta ordem:
1. intercepta a chamada da SPA durante o `goto`;
2. se não viu a chamada, **recarrega uma vez** e escuta de novo;
3. se ainda assim não veio, lê o payload do `__NEXT_DATA__` do HTML
   (`findSearchResults` procura em qualquer profundidade).

**Paginação mudou:** era `actualPage=N` na URL da API; agora é `?page=N` na
página de busca. `page` **não** está na lista de Disallow do robots.txt (2-D).

`getJsonViaBrowser` **deixou de existir** — quem chamava era o adapter, já
migrado. Não recrie: fabricar a chamada é exatamente o que não funciona.

### 2026-09-08, 00:25 — a interceptação da SPA FUNCIONA; a coleta caiu por outro motivo

Depois da correção acima, o probe passou e a coleta rodou **7 minutos sem um
único 403**. A abordagem de interceptar a chamada da própria SPA está validada:
o PerimeterX não é mais o problema.

A rodada morreu na ~6ª página com:

```
browserContext.newPage: Target page, context or browser has been closed
```

O Chromium morreu sozinho. Suspeito principal: **memória** — o servidor do
painel já tinha sido morto pelo Windows por OOM nesta mesma máquina, e o
Chromium roda com ~13 processos.

**Mas o estrago real foi de projeto, não do Chromium:** `fetch_runs` registrou
`items_found: 0`. As ~130 anúncios das 5-6 páginas boas foram **descartadas**,
porque `adapter.search()` propagou a exceção e o pipeline perdeu o array
inteiro. Sete minutos de coleta viraram zero.

**Três correções (feitas, `node --check` e `import` passam, execução não testada):**

1. **`webmotors.js` — paginação tolerante a falha.** Cada página em `try/catch`:
   se já houver resultados, loga aviso e **devolve o parcial**; só propaga o erro
   quando não coletou nada. Coleta parcial vale muito mais que coleta nenhuma.
2. **`browser.js` — contexto que ressuscita.** `acquirePage()` reabre o contexto
   se ele estiver morto, e `getSearchPayload` repete a página **uma vez** quando
   o erro é de navegador fechado (`isClosedError`).
3. **`webmotors.js` — log de progresso por página.** Antes o processo ficava
   **~10 minutos completamente mudo**, indistinguível de travamento — o usuário
   não sabia se esperava ou matava. Agora sai
   `pagina 3/9: +24 anuncios (acumulado 72 de 205)`.

### 2026-09-08 — PRIMEIRA COLETA REAL BEM-SUCEDIDA 🎉

```
206 anuncios para /carros-usados/estoque/mitsubishi/lancer
mitsubishi-lancer/webmotors: 21 anuncios (de 206 brutos)
rodada concluida {"new":21,"drops":0,"ups":0,"vanished":1,"relisted":0,"failures":0}
```

**21 Lancers reais no banco**, com FIPE e faixa de km. O usuário resolveu um
CAPTCHA "press & hold" na janela do Chromium; a sessão ficou salva em
`data/browser/` e deve dispensar isso nas próximas rodadas.

Distribuição: 4 até 50 mil km · 5 de 50-70 mil · 12 de 70-100 mil.
Melhor preço relativo: Lancer 2014, 98.000 km, R$ 57.000, **97% da FIPE** (SP).

⚠️ Um Evolution X 4x4 turbo (R$ 212.000) aparece na busca — é outro carro, mas
casa com "Lancer". Não é bug.

### ✅ PENDÊNCIA ANTIGA FECHADA: a URL do anúncio está correta

Arrastava-se desde a sessão 3. O usuário clicou nos links do painel e **abriram
os anúncios certos**. O `buildListingUrl()` monta
`/comprar/{marca}/{modelo}/{versao}/{portas}-portas/{anoFab}-{anoModelo}/{id}`
e está validado contra o site real. Não precisa mais ser tratado como suposição.

### Bug encontrado nessa coleta: a SPA faz MAIS DE UMA chamada de busca

O log denunciou:

```
pagina 1/12700: +47 anuncios (acumulado 47 de 304793)   <- estoque do site inteiro
pagina 2/9:     +47 anuncios (acumulado 94 de 206)      <- a busca certa
pagina 3/12700: +47 anuncios (acumulado 141 de 304793)  <- errado de novo
```

`304793` é o site todo; a busca do Lancer tem 206. A página dispara várias
chamadas a `/api/search/car` (busca real + destaques/recomendados) e o
`waitForResponse` pegava a primeira que chegasse.

Efeito: das 206 linhas coletadas, só ~65 eram Lancer. **Nenhum carro errado
entrou no banco** — o `matchesWatch` filtrou por modelo — mas a coleta ficou
incompleta, e o `vanished: 1` foi **falso positivo** (o Lancer do fixture caiu
numa página contaminada; volta como `RELISTED` na próxima rodada).

**Corrigido com duas barreiras** em `src/http/browser.js`:
1. `isOurSearch()` — só aceita a resposta cujo parâmetro `url=` aponta para o
   nosso `searchPath`.
2. `payloadMatchesPath()` — confere o `SEO.Canonical` do payload. Não batendo,
   descarta em vez de gravar carro errado.

Também: o log de páginas passou a usar o tamanho de página **observado** (a SPA
devolve 47, não os 24 que pedimos), que era a origem do "1/12700".

### Botão "Coletar agora": consertado

Queixa do usuário: "não funciona direito". Dois defeitos reais.

1. **A rota segurava a resposta.** `POST /api/collect` fazia
   `await collectNow()` — só respondia ~6 minutos depois. O `fetch` do painel
   estourava o timeout e o botão voltava ao normal **como se tivesse
   terminado**, enquanto a coleta seguia rodando no servidor.
2. **Silêncio total** durante os 6 minutos.

Correções:
- `POST /api/collect` responde **202 na hora** (`startCollect()`), e a coleta
  roda em segundo plano.
- Novo `src/core/progress.js` — estado em memória (`running`, `step`,
  `elapsedMs`, `stats`, `error`). Módulo bobo de propósito: progresso não é dado
  de negócio e pode se perder num restart.
- `GET /api/summary` passou a devolver `progress`.
- `public/app.js` faz polling de 2s: mostra `Coletando... 3:20`, o passo atual
  no `title`, e ao fim `+21 novos, 0 baixas`. Se a página abrir no meio de uma
  coleta (a diária das 9h), o botão já entra em modo de acompanhamento.

### Barra de progresso no botão (pedido do usuário) + o alerta que faltava

O contador numérico virou **barra de progresso dentro do próprio botão**:
`<button id="collect"><i class="bar"></i><span>…</span></button>`, com a `.bar`
absoluta preenchendo da esquerda para a direita.

Decisões que valem manter:
- **A porcentagem vem das PÁGINAS, não do tempo.** O tempo por página varia
  demais (jitter do rate limit, CAPTCHA, recarga); barra por relógio andaria
  errado. `progress.js` passou a expor `page`, `totalPages`, `collected`,
  `total` — números estruturados, para o painel não interpretar texto.
- **Modo indeterminado enquanto `totalPages` é desconhecido.** A 1ª página inclui
  abrir o navegador e um eventual CAPTCHA; inventar porcentagem ali seria mentir.
- **Teto de 95% durante a paginação.** Gravar, enriquecer FIPE e notificar vêm
  depois da última página.

### ⚠️ A coleta pelo botão das 01:20 FALHOU — e o painel não avisou

O usuário achou que tinha dado certo ("demorou uns 5 minutos, a tela fechou, a
busca deu certo"). O log diz outra coisa:

```
01:20:52  navegador aberto
01:21:53  bloqueio PerimeterX na tela — RESOLVA NA JANELA (aguardo ate 5 min)
01:26:54  bloqueio PerimeterX nao foi resolvido a tempo    <- FAILED
```

A janela fechou por **timeout**, não por conclusão. Os 21 Lancers na tela eram
da rodada das 00:46. `fetch_runs` registrou o 5º `FAILED`.

**Causa de UX, não de código de rede:** quem clica no botão fica olhando o
**painel**, não a janela do Chromium. O botão dizia "Coletando..." enquanto o
sistema esperava por uma pessoa — e a espera expira em 5 minutos, levando a
coleta inteira junto.

**Corrigido:**
- `progress.js`: `needsHuman` + `needsHumanText`, zerados em
  `startProgress`/`endProgress` e num `finally` no `browser.js` (para não ficar
  preso se a espera estourar).
- `browser.js`: chama `setNeedsHuman(true, ...)` ao entrar na espera. Nota de
  camada: `http/` importando `core/progress.js` é intencional — progresso é
  preocupação transversal, como o logger.
- `app.js`: `needsHuman` tem **prioridade sobre a barra** — mostra
  `⚠ Resolva o CAPTCHA na janela` em âmbar, pulsando.

**O CAPTCHA vai voltar.** A sessão em `data/browser/` reduz a frequência, mas o
PerimeterX re-desafia de tempos em tempos. Por isso o aviso no painel é
essencial, e por isso `BROWSER_HEADLESS=false` não deve virar `true`.

## ✅ 2026-09-08 02:01 — A COLETA DO WEBMOTORS ESTÁ FUNCIONANDO

Verificado em `fetch_runs`, não na tela:

```
status: OK  |  items_found: 66  |  duration: 287s (4min47)
206 anuncios para /carros-usados/estoque/mitsubishi/lancer
mitsubishi-lancer/webmotors: 66 anuncios (de 206 brutos)
rodada concluida {"new":44,"drops":0,"ups":0,"vanished":0,"relisted":1,"failures":0}
```

**66 Lancers ativos no banco** (eram 21). As 5 páginas vieram todas com
`Count: 206` — nenhuma contaminada. E **sem CAPTCHA**: a sessão salva em
`data/browser/` funcionou como projetado.

**A validação por conteúdo funcionou às claras.** O log mostra o mecanismo
trabalhando, uma vez por página:

```
ignorando busca alheia (canonical: https://www.webmotors.com.br/carros-usados/estoque)
```

Ou seja: a página realmente dispara **duas** buscas — a nossa e uma genérica do
estoque inteiro. Era essa segunda que envenenava a coleta das 00:41 com
`Count: 304793`. Agora ela é rejeitada e o ouvinte espera a certa.

**O `RELISTED: 1` confirma a previsão:** o Lancer marcado como "sumiu" por causa
do bug de interceptação voltou sozinho, como esperado. Nenhum evento falso
sobrou.

### Por que 66 e não 21

Não é o mercado que mudou: são as páginas que antes vinham contaminadas. Das 5
páginas, 3 traziam carros aleatórios do site inteiro (descartados pelo
`matchesWatch`). Com todas corretas, os 206 brutos rendem 66 Lancers abaixo de
100 mil km. **66 é o número real.**

### Correção de UX junto (barra andando para trás)

O log trouxe `pagina 5/12` na última volta. Causa: `porPagina` era recalculado a
cada página, e a última vem menor (18 de 206) — `206/18 = 12`. A barra pularia
de **80% para 42%** bem no fim.

Corrigido: `porPagina` é fixado na **primeira** página. Conferido com os números
reais desta coleta: 20% → 40% → 60% → 80% → 95%, monotônico.

---

### PLACAR REAL DAS COLETAS (não confiar na aparência — conferir `fetch_runs`)

| Hora (UTC) | Status | Itens | Duração | O que aconteceu |
|---|---|---|---|---|
| 00:32 | FAILED | 0 | 7min | Chromium morreu na ~6ª página (memória) |
| **00:46** | **OK** | **21** | **4min43** | **Única coleta bem-sucedida até agora** |
| 01:26 | FAILED | 0 | 6min | CAPTCHA não resolvido (painel não avisava) |
| 01:37 | FAILED | 0 | 2min06 | CAPTCHA resolvido em 15s, mas não renavegamos |
| 01:54 | FAILED | 0 | 2min19 | `page.goto` pendurado + filtro por URL errado |
| **02:01** | **OK** | **66** | **4min47** | **Tudo certo, sem CAPTCHA, 5/5 páginas boas** |

**Duas vezes o usuário achou que tinha dado certo e não tinha.** A janela do
Chromium fechar e o painel mostrar carros não significa sucesso — os carros
eram sempre os 21 da rodada das 00:46. **A fonte da verdade é `fetch_runs`:**

```sql
SELECT status, items_found, duration_ms, error, started_at
  FROM fetch_runs ORDER BY started_at DESC LIMIT 5;
```

### O alerta de CAPTCHA FUNCIONOU (01:37)

```
01:38:29  bloqueio PerimeterX na tela — RESOLVA NA JANELA
01:38:44  bloqueio liberado, seguindo      <- 15 segundos
```

O usuário viu o aviso âmbar no painel, foi à janela e resolveu. O ciclo
"painel avisa → pessoa resolve → coleta segue" está **validado**.

### Mas a coleta morreu logo depois — falha de sequência

Depois do desbloqueio: `nao consegui obter os resultados — nem pela chamada da
SPA nem pelo __NEXT_DATA__`.

Causa: o ouvinte (`waitForResponse`, 60s) era montado **antes** do `goto`, e o
relógio dele **corria durante a espera humana**. Pior: depois de o usuário
resolver, **ninguém renavegava** — a aba continuava na tela do desafio, a SPA
nunca disparava a busca, e o ouvinte expirava.

**Corrigido:** `getSearchPayload` virou um laço de até 3 tentativas, com
**ouvinte novo a cada volta**. `ensureNotBlocked()` agora devolve `true` quando
precisou esperar um humano; nesse caso a tentativa é descartada e recomeça com
navegação limpa. Não testado ainda.

### 01:54 — 5ª falha, e a causa raiz que estava escondida desde o começo

```
01:55:07  nao vi a chamada da SPA (tentativa 1) — renavegando
01:55:08  bloqueio PerimeterX na tela
01:55:20  bloqueio liberado — vou renavegar        <- usuario resolveu em 12s
01:56:20  FALHOU: page.goto: Timeout 60000ms exceeded
```

Duas causas, uma delas presente em **todas** as tentativas anteriores:

**A causa raiz — `nao vi a chamada da SPA`.** Essa linha aparece em 01:21,
01:38 e 01:55. Eu filtrava a resposta **pela URL da requisição**
(`isOurSearch`), tentando adivinhar o formato exato da chamada que a SPA faz.
A suposição estava errada, então a resposta boa era ignorada e o prazo
expirava — mesmo quando o usuário resolvia o CAPTCHA em 12 segundos.

Ironia: a versão *original*, com filtro largo (`url.includes('/api/search/car')`),
**funcionava** — foi ela que trouxe os 21 anúncios às 00:46. Ao consertar o
problema do payload errado eu apertei o filtro demais e quebrei o que funcionava.

**Corrigido — julgar pelo CONTEÚDO, não pela URL.** `esperarBuscaCerta()` escuta
*toda* resposta de `/api/search/car` e aceita a primeira cujo payload tenha
`SearchResults` **e** `SEO.Canonical` batendo com o nosso path. Payload de outra
busca não resolve a promessa: segue ouvindo. Assim não dependemos de adivinhar
formato de URL **e** continuamos protegidos contra gravar carro errado.

`isOurSearch` foi **removido**, com um comentário no lugar avisando para não
reintroduzir filtro por URL.

**Segunda causa — `page.goto` pendurado.** Esperava `domcontentloaded` por 60s.
Agora usa `waitUntil: 'commit'` (a navegação só precisa *disparar* a busca; quem
entrega o resultado é o ouvinte), com timeout de 30s **tolerado, não fatal**:
se a navegação demorar, seguimos ouvindo.

### Onde o projeto realmente está

**Funciona e está provado:** banco, pipeline completo, painel, FIPE, faixas de
km, URL dos anúncios (usuário clicou e conferiu), transporte por navegador
(interceptação da SPA), alerta de CAPTCHA, barra de progresso.

**A coleta ponta a ponta:** 2 sucessos em 6 tentativas, sendo o último o mais
completo (66 anúncios, 5/5 páginas corretas, sem CAPTCHA). As 4 falhas tiveram
**causas diferentes** e cada uma virou uma defesa permanente:

| Falha | Defesa que ficou |
|---|---|
| Chromium morreu por memória | paginação tolerante + contexto que ressuscita |
| CAPTCHA invisível ao usuário | alerta âmbar no painel (`needsHuman`) |
| Ouvinte expirava durante o CAPTCHA | ouvinte novo a cada tentativa + renavegação |
| Filtro por URL ignorava a resposta boa | validação por conteúdo (`SEO.Canonical`) |

Não é uma fonte "resolvida" — é uma fonte instável com um sistema que agora
absorve as instabilidades conhecidas. Que era o requisito principal do projeto
desde o começo (seção 5).

**O que ainda pode quebrar, em ordem de probabilidade:**
1. **CAPTCHA numa coleta desacompanhada** (a diária das 9h). Expira em 5 min e
   perde a rodada. Ninguém vai estar olhando o painel às 9h.
2. **Memória** — o Chromium já derrubou o servidor do painel uma vez.
3. **O site mudar o payload.** Aí `probe:wm:browser` + fixtures são o caminho.

**Ideia para a pendência 1, não construída:** notificação (Telegram já está
escrito, `NOTIFY_ENABLED=false`) avisando "CAPTCHA esperando" — hoje o alerta só
existe para quem estiver com o painel aberto.

### Configuração: FEITA e conferida

- ✅ **Playwright instalado pelo usuário** — `playwright@^1.63.0` no
  `package.json`, Chromium em
  `C:\Users\Sony\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`.
- ✅ **`.env` aplicado e lido de volta pelo `config.js`:**
  `COLLECT_CRON="0 9 * * *"` · `browser.enabled=true` ·
  `browser.headless=false` · rate limit 60000ms + 20000ms de jitter.
- ✅ `src/config.js` e `src/adapters/webmotors.js` **importam sem erro** (o
  `import()` de teste passou junto com a leitura da config).

### ⚠️ O QUE FALTA: rodar. Nada do transporte via navegador foi executado.

O classificador do ambiente **bloqueia a execução** do código que passa pelo
PerimeterX — tanto o probe quanto a coleta. Não é problema do código; é política
do ambiente. **Quem roda é o usuário**, e nesta ordem:

1. **Teste de uma requisição só** (criado nesta sessão, `probe:wm:browser`):
   ```bash
   npm run probe:wm:browser
   ```
   Abre uma janela do Chromium. Se aparecer desafio, **resolver na janela** — a
   sessão fica em `data/browser/` e as próximas rodadas reaproveitam.
   - Deu `Count: 205` e um Lancer no topo → o transporte funciona, siga.
   - Deu `403 mesmo via navegador` → ver "Risco conhecido" abaixo, plano B.

2. **Primeira coleta real**, só depois do passo 1 dar certo:
   ```bash
   npm run collect webmotors
   ```
   São ~9 páginas × 60–80s = **10 a 12 minutos**, com a janela aberta.

3. **Conferir a URL do anúncio** clicando num link do painel (pendência antiga,
   desde a sessão 3 — a URL é montada pelo adapter, não vem no payload).

### Aviso de memória

O servidor do painel foi **morto pelo Windows por falta de memória** durante esta
sessão. O Chromium do Playwright custa uns 200–400 MB de RAM por janela. Se a
coleta morrer no meio, suspeite disso antes de suspeitar do código.

### Risco conhecido que ninguém testou

A chamada `page.evaluate(fetch(...))` para `/api/search/car` é same-origin, então
deve carregar os cookies do PerimeterX. **Mas isso é teoria** — pode ser que o PX
exija também um header assinado por JS do próprio site, e aí a resposta virá 403
mesmo de dentro do navegador. O `browser.js` já trata esse caso com mensagem
específica ("403 mesmo via navegador"). Se acontecer, o plano B é **navegar de
verdade pelas páginas HTML e ler o `__NEXT_DATA__`** em vez de chamar a API, ou
partir para provedor terceiro (opção 2 da seção 2-D).

---

## 2-F. SESSÃO 5 (2026-09-08) — verificação independente e relatório publicado

O usuário pediu para **verificar o relatório do projeto e tudo o que foi feito**, e
publicar em seguida. Nada foi coletado nesta sessão: o trabalho foi conferir no
banco e nos logs se o que está escrito aqui corresponde ao que existe de fato.

**Relatório publicado** (estado verificado, placar das 10 rodadas, leitura dos
66 Lancers, pendências e próximos passos). O link ficou fora deste arquivo de
propósito; para atualizar o relatório, republicar sobre a mesma URL — senão
cria-se um documento novo em vez de atualizar o que existe.

### O que a verificação confirmou

Consultando `fetch_runs`, `listings`, `events` e `logs/2026-09-08.log`:

- **66 anúncios ativos**, todos do Webmotors, **100% com `fipe_ratio` e foto**.
- Faixas de km: 13 até 50 mil · 12 de 50-70 mil · 41 de 70-100 mil.
- Eventos: 66 `NEW`, 1 `DISAPPEARED`, 1 `RELISTED`.
- `fetch_runs`: **10 registros — 3 OK, 7 FAILED**. Um dos OK é o ingest de fixture
  (1 item, 0s), então o placar de coleta de rede é **2 de 9**.
- `node --check` passa nos 30 arquivos JS. São 3.539 linhas em 38 arquivos.
- As correções que a sessão 4 diz ter feito **estão mesmo no código**:
  `porPagina` fixado (`webmotors.js:147`), `waitUntil: 'commit'`
  (`browser.js:204`), laço de 3 tentativas (`browser.js:195`),
  `setNeedsHuman` importado de `core/progress.js` (`browser.js:31`).

### 🔴 Achado 1: a coleta agendada das 9h de 2026-09-08 NÃO rodou

`fetch_runs` não tem **nenhum** registro depois de 08/09 02:06, e
`GET http://localhost:3000/` não responde. O servidor está fora do ar desde o fim
da sessão 4, e o agendador vive dentro do processo do painel.

Não é regressão — é exatamente o risco já documentado ("o agendador só dispara com
o servidor de pé"). O que a verificação acrescenta é que **isso já aconteceu na
prática, e nada avisou**: o painel mostraria os 66 carros de ontem sem indicar a
idade do dado. Vale considerar mostrar no painel a data da última rodada OK.

### 🔴 Achado 2 (bug): `fetch_runs.started_at` grava o FIM da rodada

O `INSERT` em `src/db/repositories/watches.js:18` não passa a coluna, então o
`DEFAULT CURRENT_TIMESTAMP` do `schema.sql` é avaliado **quando a linha entra** —
depois de a rodada terminar.

Prova: a rodada boa está gravada como `02:06:04`, mas o log mostra
`02:01:23 navegador aberto` — 287s antes, exatamente o `duration_ms`.

**Consequência:** a consulta de diagnóstico deste arquivo ordena por fim, não por
início, e a tabela "PLACAR REAL DAS COLETAS" da seção 2-C tem horários deslocados
pela duração de cada rodada. Correção é de uma linha (passar o início no INSERT,
ou `NOW() - INTERVAL duration_ms/1000 SECOND`).

### 🟡 Achado 3: três correções nunca foram exercidas

Entraram **depois** da última coleta boa: o laço de 3 tentativas com ouvinte novo,
o `waitUntil: 'commit'` e o `porPagina` fixado. O log das 02:06 ainda mostra o
sintoma antigo (`pagina 5/12`). São justamente os **caminhos de recuperação de
falha** — os que só rodam quando algo dá errado. Continuam sem verificação.

### 🟡 Achado 4: a média de 139% da FIPE é enganosa

Os 66 incluem **18 Evolution / Sportback Ralliart** (até R$ 549.900 e 1125% da
FIPE). Isolando os **48 Lancers comuns**: preço de R$ 45.000 a R$ 90.000, mediana
**R$ 69.900**, média de **124% da FIPE**, km médio 77.637.

Também há dado sujo do próprio anunciante — um Lancer 2015 com **115 km** e um
1993 por R$ 45.000. O pipeline grava o que a fonte diz, o que está correto; a
ressalva é de leitura, não de código.

Isso reforça a pendência 3 da seção 4: decidir com o usuário se Evolution e
Ralliart devem ser separados do painel.

### Recorte de mercado que saiu da verificação

40 dos 66 em SP · RJ 9 · RS 5 · MG/SC/PA 3 cada · PR 2 · GO 1.
45 de particular contra 21 de loja. Só 8 manuais — o Lancer usado é
essencialmente automático (28) ou CVT (25).

FIPE: 9 abaixo de 100% · 26 entre 100-110% · 26 entre 110-150% · 5 acima de 150%.
Melhor negócio relativo: **Lancer 2.0 HL-T 2019, 85.000 km, R$ 60.000, 84% da
FIPE**, particular em Itaquaquecetuba/SP.

### 2026-09-08 22:01 — o usuário rodou uma coleta, e ela fechou o achado 3

Enquanto o relatório era escrito, o usuário subiu o painel e coletou:

```
status: OK  |  items_found: 63  |  duration: 263s (4min23)
203 anuncios para /carros-usados/estoque/mitsubishi/lancer
pagina 5/5: +15 anuncios (acumulado 203 de 203)
rodada concluida {"new":1,"drops":2,"ups":0,"vanished":4,"relisted":0,"failures":0}
```

Três coisas ficaram provadas de uma vez:

1. **A correção do `porPagina` está verificada.** O log mostra `pagina 5/5` — antes
   dava `pagina 5/12`, e a barra pulava de 80% para 42% no fim. Fecha o achado 3
   para esse item; o laço de 3 tentativas e o `waitUntil: 'commit'` continuam sem
   exercício, porque nada falhou nesta rodada.
2. **Os eventos de preço funcionaram pela primeira vez com dado real:**
   2 `PRICE_DROP`, 1 `NEW`, 4 `DISAPPEARED`. Até aqui só existiam `NEW`.
3. **Segunda coleta boa seguida, sem CAPTCHA.** A sessão em `data/browser/` está
   se sustentando.

Estado do banco depois dela: **63 ativos** (eram 66), 67 no histórico.

---

### Filtro por câmbio no painel (pedido do usuário)

O usuário pediu para filtrar por tipo de câmbio — manual, automático, CVT. Feito
seguindo **exatamente o padrão das faixas de km**, que já estava certo:

- **`src/core/normalize.js`** — `TRANSMISSIONS` + `transmissionGroup()`. Derivado
  na leitura, **nunca gravado**: cada fonte escreve o rótulo do seu jeito e o
  texto cru continua em `listings.transmission`. Se o Webmotors mudar o rótulo,
  muda-se a tabela e nada é recoletado.
- **`src/server.js`** — `cambioWhere()` traduz o **mesmo** spec para SQL
  (`LIKE`/`NOT LIKE`), porque o recorte precisa acontecer no banco para o `LIMIT`
  continuar correto. `/api/cambios` devolve a contagem por grupo, `/api/listings`
  aceita `?cambio=` e passou a devolver `transmission` e `cambio`.
- **Painel** — segunda linha de chips (cada linha agora tem rótulo: `km` e
  `cambio`) e coluna **Cambio** na tabela, com o rótulo cru da fonte no `title`.

**Os grupos.** `manual` · `automatico` (conversor) · `cvt` · `automatizado`
(robotizado: `Automatizada`, `Automatizada DCT`, `Semi-automática`). São
mutuamente exclusivos de propósito — a soma dos chips fecha com o total.

**Por que os trechos de `match` são ASCII** (`autom`, não `automatica`): assim o
`LIKE` funciona mesmo se a coluna deixar de ser `utf8mb4_unicode_ci`, que hoje
ignora acento. Um detalhe pequeno que evitaria um filtro silenciosamente vazio.

**O balde `outro`.** Rótulo que nenhum grupo reconhece cai em `outro`, que aparece
em vermelho na tabela e só vira chip quando existe. É como um contrato novo da
fonte aparece no painel em vez de sumir em silêncio — mesma filosofia do
`fetch_runs`.

**Os dois filtros compõem.** `/api/km-bands` respeita o câmbio selecionado e
`/api/cambios` respeita a faixa de km, então a contagem de cada chip reflete o
outro recorte. Um `filtrosComuns()` compartilhado pelos três endpoints garante
isso sem duplicar regra.

#### Verificado contra o banco real (não só escrito)

| Checagem | Resultado |
|---|---|
| Contagem dos chips | manual 7 · automatico 27 · CVT 24 · automatizado 5 = **63**, fecha com o total |
| SQL x JS, grupo a grupo | `?cambio=X` devolve **só** anúncios cujo `cambio` derivado é X, nos 4 grupos |
| Rótulos crus por grupo | `automatizado` → `Automatizada`, `Automatizada DCT`, `Semi-automática` |
| `outro` | 0, como esperado — nenhum rótulo desconhecido hoje |
| Composição | `?cambio=manual` → faixas 2/3/2/0 = 7 ✓ · `?band=70k-100k` → 2/15/18/3 = 38 ✓ |
| Painel | `/`, `/app.js`, `/style.css` → 200; todos os ids que o `app.js` procura existem no HTML |

⚠️ **O painel foi reiniciado** para carregar o código novo (`config.js` e as rotas
só são lidos na importação). Nenhuma coleta estava em andamento na hora —
conferido em `/api/summary` antes de derrubar.

### Alinhamento e espaçamento da tabela de anúncios (pedido do usuário)

Queixa: "as informações não estão alinhadas com os títulos". Estava mesmo —
`th { text-align: left }` valia para todos os cabeçalhos, mas as células de
**Ano, KM, Preço e FIPE** usam `.num { text-align: right }`. Quatro das nove
colunas ficavam com o título de um lado e o valor do outro.

O usuário então especificou a tabela inteira, e foi isso que ficou. **Só
alinhamento e espaçamento** — nada de dado, filtro, cor, tema ou ordenação.

| Regra | Como ficou |
|---|---|
| Cabeçalho e célula alinhados | as duas carregam a **mesma classe** (`num` ou `badge`) |
| Numéricas (Ano, KM, Preço, FIPE) | à direita, com `tabular-nums` — dígitos em coluna |
| Badges (Faixa, Câmbio) | centralizadas, badge com `min-width` igual em toda linha |
| Texto (Anúncio, Local, Fonte) | à esquerda |
| Grade | `table-layout: fixed` + `<colgroup>`; Anúncio `auto`, resto fixo |
| Espaçamento | 12px em todas as colunas, 18px na primeira e na última |
| Linhas | `vertical-align: middle` e altura fixa de 44px |

**Por que a grade fixa importa aqui, e não é só estética:** sem ela a largura da
coluna vinha do conteúdo, então **a tabela se remontava a cada filtro** — um
Evolution de R$ 549.900 alargava a coluna de preço e empurrava todas as outras.
Com `table-layout: fixed`, trocar de chip não mexe mais na grade.

Consequência aceita: títulos longos **truncam com reticências** em vez de quebrar
em duas linhas (era o que fazia as linhas terem alturas diferentes). Para o texto
cortado não se perder, o título completo foi para o `title` do link — passar o
mouse mostra inteiro. As larguras fixas foram dimensionadas pelo **maior valor
real** de cada coluna (`R$ 549.900`, `+1025.0%`, `São Bernardo do Campo/SP`).

As regras novas são **escopadas em `#listings`**, para não alcançarem nenhuma
outra tabela que venha a existir. Ficou um comentário no `.num` do `style.css`:
ao acrescentar coluna numérica, marque `<th>` **e** `<td>`.

#### Conferido no navegador, não no raciocínio

Um Chromium headless abriu `localhost:3000` e mediu o resultado:

| Checagem | Resultado |
|---|---|
| Alinhamento por coluna | 9/9 com `th` e `td` iguais |
| Borda esquerda da coluna | 9/9 idêntica entre cabeçalho e todas as células |
| Largura por coluna | 9/9 constante em todas as linhas |
| Altura das linhas | **um único valor**: 44px |
| Largura dos badges | **um único valor**: 92px |
| Scroll horizontal | nenhum |
| Erros de JS na página | nenhum |

⚠️ Isso **não** contradiz a regra do `BROWSER_HEADLESS=false`: aquela vale para o
navegador da **coleta**, que enfrenta o PerimeterX e precisa de janela para
alguém resolver o CAPTCHA. Um screenshot do painel local não tem anti-bot
nenhum. O script usa `chromium.launch()` efêmero e **não toca em
`data/browser/`** — é um jeito barato de conferir mudança de painel sem depender
de o usuário descrever o que está vendo.

### Apresentação do topo do painel: cabeçalho, cards e "O que mudou"

Pedido do usuário, com 11 itens especificados. **Só apresentação** — nada de
dado, lógica de coleta, filtro ou paleta. A paleta escura atual foi mantida
inteira; as cores novas saem todas das variáveis que já existiam.

**Cabeçalho.** O texto solto `atencao: webmotors com falhas` virou um **chip**
âmbar translúcido com ícone SVG inline (sem dependência nova). Três decisões:

- **Some quando não há falha.** `#status` fica `hidden` e não ocupa espaço. Um
  aviso permanente vira ruído e para de ser lido. Precisou de
  `.status[hidden] { display: none }` explícito, porque o `display:inline-flex`
  da classe venceria o `display:none` do atributo.
- **O tooltip responde a pergunta seguinte:** qual fonte, quantas falhas em 7
  dias, quando foi a última tentativa e o último sucesso. Tudo isso **já vinha**
  em `/api/summary` (`health`), então nada mudou no servidor.
- **Nome da fonte escrito certo:** o banco guarda o slug (`webmotors`); um mapa
  `FONTE_NOME` cuida da caixa e do acento (`Mercado Livre`).

**Botão "Coletar agora": três estados.** Normal · coletando (spinner + desabilitado,
mas legível) · desabilitado (apagado). O spinner **não gira** em `needs-human`
nem depois de terminar — girar ali seria mentir sobre o que o sistema está
fazendo. A barra de progresso continua igual, por baixo.

**Cards.** Altura fixa de 92px e `justify-content: center`, então um label de duas
linhas não desloca o número dos vizinhos. `tabular-nums` no valor. **Cor semântica
só no número** — o label continua secundário nos quatro: neutro em ativos, azul
em novos, verde em baixas, vermelho em saíram do ar.

**Lista "O que mudou".** Era `display: flex`, e o badge mudava de largura conforme
o texto (`novo` × `reanunciado`), então **cada título começava num x diferente**.
Virou `grid` de duas colunas com badge de `min-width` fixo — título e metadados
na mesma coluna. Scrollbar fina com trilho transparente, mantendo o
`max-height: 440px`.

#### Medido no navegador

| Checagem | Resultado |
|---|---|
| Chip e botão no mesmo centro vertical | ambos em y=41 |
| Chip sem falha | fora do DOM, `hidden`, largura 0 |
| Estados do botão | normal (sem spinner) · coletando (spinner, opacidade 1) · desabilitado (0.5) |
| Altura dos cards | **um único valor**: 92px · padding idêntico |
| `tabular-nums` nos quatro | sim |
| Cor dos números | neutro `#e6e8ec` · azul · verde · vermelho |
| Largura dos badges de evento | **um único valor**: 104px, centralizados |
| x inicial dos títulos | **um único valor**: 157px (em 60 eventos) |
| Espaçamento entre itens | 12px + divisória de 1px, uniforme |

Cheguei a suspeitar que os metadados estavam saindo numa cor quente, mas medi:
`rgb(139,147,163)` — é `--muted` exatamente. Era leitura errada do screenshot.


### Redesenho visual do painel (style.css reescrito do zero)

Pedido do usuário, com especificação fechada de cores, medidas e estados.
**Só apresentação:** `public/app.js` não foi tocado, nem rota, nem SQL, nem
regra de negócio, e nenhuma coleta foi disparada. Antes de começar, conferido em
`/api/summary` que não havia coleta em andamento.

`public/style.css` foi **reescrito inteiro**; `public/index.html` mudou só no
cabeçalho (wordmark + linha `.watch`) e ganhou um `<main class="wrap">` em volta
das seções. O tema claro **foi removido** — o painel agora é escuro e só.

**O ponto crítico era o contrato do `app.js`.** O JS injeta HTML com classes que
o CSS precisa conhecer; se alguma ficar sem regra, o painel quebra **em
silêncio** — nada falha, o elemento só para de aparecer direito. Antes de
escrever, listei todos os seletores que o `app.js` usa; depois de escrever,
conferi um a um.

#### O que foi verificado, e como

Grep dos 51 nomes do contrato no CSS novo, **ignorando comentários** (a primeira
checagem passou por engano: `#bands` e `#cambios` só apareciam dentro de um
comentário, não como regra — corrigido com uma regra de verdade).
Resultado: **51/51 com regra real**.

Depois, Chromium headless efêmero em `localhost:3000` — `chromium.launch()`,
**sem tocar em `data/browser/`**:

| Checagem | Resultado |
|---|---|
| (a) erros de JS no console | nenhum |
| (b) alinhamento th/td nas 9 colunas | 9/9 iguais, e a borda esquerda idêntica |
| (c) altura de linha | **um único valor**: 46px |
| (d) largura dos badges | kmband **88px** · gear **96px** · tag de evento **104px**, um valor cada |
| (e) scroll horizontal a 1440px | nenhum |
| (f) clique nos 10 chips (km e câmbio) | grade **idêntica** em todos; nenhum remonte |
| Estados do botão | normal · indeterminate (listras `barStripes`) · collecting · needs-human (laranja + `pulseDot`) · done · failed — todos conferidos |
| Responsivo a 700px | padding 14px · `.watch` sem borda · botão ocupando a linha · sem scroll |
| Células cortadas | só a coluna Anúncio, que trunca por projeto (título completo no `title`) |

#### Duas armadilhas que a medição pegou

**1. Especificidade — regressão real, já corrigida.** O seletor novo
`#listings th` carrega especificidade de id (1,0,1) e **venceu** `.num` (0,1,0),
jogando todo cabeçalho para a esquerda enquanto o valor ficava à direita — ou
seja, desfez em silêncio a correção de alinhamento da sessão anterior. A folha
agora traz `#listings th.num` e `#listings th.badge` explícitos, com comentário
dizendo por quê. **Sem medir no navegador, isso teria passado.**

**2. Falso positivo meu na leitura dos estados.** Achei que a borda do botão não
mudava de cor. Não era bug: `border-color` tem transição de 150ms e eu lia o
valor no instante do clique. Medindo depois de 260ms, todas as cores estão
certas. Fica o registro para não se repetir: **ao medir algo com transição,
esperar a transição**.

#### Desvios conscientes da especificação

- **Padding das colunas de badge: 6px, não 12px.** É aritmética, não capricho.
  A coluna Faixa tem 108px e o badge pede 88px de `min-width`; com 12px de cada
  lado sobravam 84px e o badge saía **cortado com reticências** (visto no
  screenshot). Com 6px sobram 96px e 106px, que acomodam os 88 e os 96 pedidos.
  As duas medidas da especificação foram preservadas; o que cedeu foi o padding.
- **`RELISTED` ficou laranja**, como a especificação pediu na seção de eventos.
  Mas isso **conflita com a regra de paleta** do mesmo pedido, que reserva
  laranja para "precisa de atenção humana (CAPTCHA)". Segui a instrução mais
  específica e registro a tensão: se o laranja tem de ser exclusivo do CAPTCHA,
  `RELISTED` deveria ir para indigo ou teal. **Decisão do usuário.**

#### Pendências que esta tarefa NÃO resolve (registradas, não implementadas)

1. **Cartão de frescor ("última coleta OK").** `/api/summary` não devolve esse
   dado; depende de ler a última linha de `fetch_runs` com `status='OK'`. É a
   contramedida para o achado 1 da seção 2-F — a coleta das 9h pode não rodar e
   o painel mostra dado velho sem avisar.
2. **Separar Evolution/Ralliart do painel** (pendência 3 da seção 4). São 18 dos
   63 anúncios e distorcem qualquer média de preço.


---

## 2-G. SESSÃO 6 (2026-09-09) — o projeto subiu; a coleta das 9h não rodou de novo

Pedido do usuário: *"vamos rodar o projeto"*. Foi só isso — nenhum código foi
alterado nesta sessão.

**O que foi feito e conferido:**

| Passo | Resultado |
|---|---|
| Serviço `MySQL80` | `Running` |
| Porta 3000 | livre antes de subir |
| `npm start` | subiu: `agendador ativo: 0 9 * * *` + `painel em http://localhost:3000` |
| `GET /` | 200 |
| `GET /api/summary` | 67 total · 63 ativos · 1 novo em 24h · 2 baixas em 7d · 5 sumiram em 7d |
| `GET /api/listings?limit=3` | devolve anúncios com URL, km, preço, câmbio — dado real |
| `fetch_runs` (conferido no banco, não na tela) | última rodada **OK**, 63 itens, 4min23 |

**Última coleta real:** `2026-09-09 01:06:41`, `OK`, **63 anúncios**, 263s.
(Lembrando o achado 2 da seção 2-F: `started_at` grava o **fim** da rodada, então
essa coleta começou por volta de `01:02`.)

Placar acumulado do Webmotors em `fetch_runs`: **4 OK / 7 FAILED**.

### 🔴 A coleta agendada das 9h de 2026-09-09 também não rodou

Não existe nenhuma linha em `fetch_runs` perto das 09:00 de hoje — a última é a
de `01:06`. É a **segunda ocorrência** do achado 1 da seção 2-F (a de 2026-09-08
também não rodou), e confirma a causa já suspeitada: **o agendador só existe
enquanto `npm start` está de pé**, e o servidor não estava rodando às 9h.

Consequência prática: o número de 63 ativos que o painel mostra agora é de
ontem de madrugada, e **o painel não sinaliza essa idade** — é exatamente a
pendência 1 do fim da seção 2-F (cartão de frescor "última coleta OK").
Observação para quem for implementar: `/api/summary` **já devolve** `health[]`
com `last_run` e `last_ok` por fonte, então o dado necessário está na mão; falta
só mostrar na tela. (A pendência 1 dizia que `/api/summary` não devolvia isso —
está desatualizada.)

**Encaminhamento sugerido ao usuário, ainda não decidido:** ou deixar o
`npm start` de pé (Tarefa Agendada do Windows / serviço), ou aceitar que a
coleta é manual pelo botão "Coletar agora". Não se mexeu em nada disso.

---

### Filtro por estado no cabeçalho LOCAL (pedido do usuário)

Pedido: *"coloque um filtro no menu por estado do anúncio. permita que o usuário
clique na palavra LOCAL na tabela de anúncios ativos e mostre as opções de
estados"*. Feito como **terceiro recorte**, seguindo o padrão de km e câmbio —
mas com UI de menu, não de chips: 27 siglas não cabem numa linha de chips como
cabem 4 faixas de km, e o usuário pediu explicitamente no cabeçalho.

**Diferença conceitual em relação aos outros dois filtros:** aqui **não há
derivação na leitura**. `parseUf()` já normaliza para a sigla de duas letras na
gravação, então `listings.uf` é coluna limpa e o filtro é `l.uf = ?`. Não existe
`ufBand()` nem tabela de grupos porque não há o que derivar.

- **`src/server.js`** — `ufWhere()` (com `sem-uf` → `l.uf IS NULL`) entrou no
  `filtrosComuns()`, então os **três filtros compõem** automaticamente; e
  `/api/ufs` devolve `[{id, count}]` contado com a mesma função dos outros
  endpoints, ordenado por contagem (quem abre o menu quer SP no topo, não AC).
- **`public/index.html`** — o `<th>` de LOCAL virou `<button class="th-btn">`
  ocupando a célula inteira (a área de clique é o cabeçalho todo, não as cinco
  letras). O `<div id="uf-menu">` fica **no `<body>`, fora da tabela**.
- **`public/app.js`** — `ufAtual`, `loadUfs()`, e abrir/fechar do menu.
- **`public/style.css`** — `.th-btn`, `.caret`, `.menu`, `.menu-item`.

**Não há lista fixa de UFs.** O menu mostra só o que a coleta trouxe, com a
contagem ao lado — **nenhuma opção do menu leva a uma tabela vazia**. O balde
`sem-uf` existe pelo mesmo motivo do `outro` do câmbio: se uma fonte mandar
local em formato que o `parseUf` não reconhece, esses anúncios aparecem no menu
em vez de sumirem em silêncio. Hoje é 0.

#### Três armadilhas de UI que custaram decisão de projeto

1. **O menu não pode morar dentro do `<th>`.** `.table-wrap` tem
   `overflow-x: auto` e recortaria o menu aberto. Por isso ele fica no `<body>`
   com `position: fixed` e coordenada calculada no JS.
2. **`position: fixed` não acompanha rolagem.** Então rolagem (com captura, para
   pegar a da própria tabela) e `resize` **fecham** o menu, em vez de deixá-lo
   flutuando longe do cabeçalho.
3. **O `<th>` não herda estilo para dentro do `<button>`.** As regras de
   cabeçalho (11px, 700, caixa alta, `letter-spacing`) tiveram de ser repetidas
   em `.th-btn`, senão o LOCAL sairia com cara de botão comum no meio da linha.

**O recorte ativo aparece no próprio cabeçalho** (`LOCAL: RJ`, em índigo). Sem
isso o filtro fica invisível para quem não abriu o menu — e a tabela mostraria
8 de 63 anúncios sem explicar por quê.

#### Verificado contra o banco real e no navegador (não só escrito)

| Checagem | Resultado |
|---|---|
| `/api/ufs` | SP 39 · RJ 8 · RS 5 · MG 3 · SC 3 · PA 2 · PR 2 · GO 1 = **63**, fecha com o total |
| `?uf=SP` | 39 linhas, **só** com `uf = SP`; `?uf=RJ` → 8, só RJ |
| Composição (os dois sentidos) | `/api/km-bands?uf=SP` = 39 ✓ · `/api/cambios?uf=SP` = 39 ✓ · `/api/ufs?cambio=manual` = 7 ✓ · `/api/ufs?band=70k-100k` = 38 ✓ |
| Três filtros juntos | `uf=SP&cambio=cvt&band=70k-100k` → 16, todos SP/cvt/70-100k |
| Entrada inválida | `?uf=XX` → 0 linhas; `?uf=` e tentativas de injeção (`SP' OR 1=1--`) caem no regex de 2 letras e **viram "sem filtro"**, não erro |
| Painel dirigido por Playwright | menu abre com as 8 opções + "todos"; clicar RJ → 8 linhas, só RJ, cabeçalho vira `Local: RJ`, chips de km recontam para 2/3/3; Esc fecha; voltar para "todos" → 63; **0 erros de console** |
| Contrato HTML×JS | todos os 12 ids que o `app.js` procura existem no HTML |

⚠️ **O painel foi reiniciado** para carregar as rotas novas. Conferido em
`/api/summary` antes de derrubar: nenhuma coleta em andamento.

**Decisão registrada:** o filtro é de **escolha única**, como os outros dois —
não dá para marcar SP + RJ ao mesmo tempo. Foi escolha de consistência com o
resto do painel; se o usuário quiser múltipla escolha, muda-se `ufAtual` para
lista e `ufWhere` para `IN (?)`.

---

## 2-H. ✅ 2026-09-09 — A OLX ESTÁ COLETANDO (2ª fonte no ar)

Pedido do usuário: *"vamos começar a coleta na OLX agora (…) eu só quero que
funcione"*, com autorização explícita para **pegar tudo e filtrar depois**.

**Resultado, conferido no banco:** `olx | OK | 12 anúncios | 3,9s`, todos
Lancer com **≤ 100 mil km** (maior: 99.500). Zero CAPTCHA, zero bloqueio.

```
SELECT source,status,items_found,duration_ms FROM fetch_runs ORDER BY started_at DESC;
  olx        OK  12    4321      <- pelo botão do painel
  olx        OK  12    3900      <- primeira, pela API
  webmotors  OK  64  270603
```

### O Cloudflare nunca foi o problema real

O `ESTADO.md` dizia desde 2026-09-06 que a OLX estava "bloqueada por Cloudflare
+ CAPTCHA". **Não está.** Na primeira tentativa pelo navegador veio `HTTP 200`
com 1,7 MB de HTML. O que bloqueava era o mesmo de sempre: `fetch` do Node.
`src/http/browser.js` resolveu, como já havia resolvido o PerimeterX.

Custo real de uma coleta da OLX: **~4 segundos**, uma página. Contra ~4,5
minutos do Webmotors (9 páginas com 60-80s de intervalo cada).

### 🔴 O robots.txt da OLX proíbe TUDO que o adapter antigo usava

Lido em 2026-09-09, salvo em `data/probe-olx-robots.txt` (637 linhas, 606
Disallow, tudo sob `User-agent: *`):

| Parâmetro | Para que servia no adapter antigo |
|---|---|
| `q=` | termo de busca ("mitsubishi lancer") |
| `o=` | **paginação** |
| `pe=` / `ps=` | preço máximo / mínimo |
| `rs=` / `re=` | ano mínimo / máximo |
| `sf=` | ordenação |
| `/q/*` | a busca textual em forma de caminho — também proibida |

É a **mesma armadilha da seção 2-D**, agora na OLX. O `buildUrl()` anterior
montava a URL com seis desses parâmetros.

**A saída foi o caminho de marca/modelo**, que não está na lista:

```
https://www.olx.com.br/autos-e-pecas/carros-vans-e-utilitarios/mitsubishi/lancer
→ 200, 57 itens extraídos, 50 anúncios reais, 100% Lancer
```

Descoberto sem adivinhar: o probe lista os caminhos de listagem que a **própria
página** oferece, e esse é o canônico dela.

**Erro meu, registrado:** a primeira requisição de busca ainda foi com `?q=`,
porque estava na mesma execução que buscou o `robots.txt`. Uma requisição, não
repetida. O probe agora **aborta** se a URL tiver qualquer parâmetro proibido.

### O JSON mudou de lugar: não existe mais `__NEXT_DATA__`

A OLX migrou para o **App Router** do Next.js. O adapter antigo procurava
`<script id="__NEXT_DATA__">` e nunca acharia nada. Hoje o payload chega em
pedaços de `self.__next_f.push([1,"<json escapado>"])` — o stream *flight* do
React Server Components.

`extractAds()` remonta o stream (11 pedaços, ~393 KB), desescapa cada pedaço com
`JSON.parse` — **não na mão** — e recorta `"ads":[...]` contando colchetes,
ignorando os que estão dentro de string. Regex não serve: há objetos aninhados e
colchetes dentro de nomes de anúncio. `extractNextData()` ficou como plano B.

**7 dos 57 itens do array são publicidade** (`{advertisingId, deviceType}`, sem
`url`). São descartados por não terem `url` — e o `externalId` deles viraria a
string `"undefined"`, que o filtro seguinte também barra.

### Paginação: 1 página por coleta, e isso é teto da fonte

Paginar exigiria `?o=2`, que tem Disallow. Não é limitação de código: é o que a
OLX permite a acesso automatizado. A página 1 traz ~50 anúncios do modelo, que
é o que interessa a quem olha todo dia. A busca inteira tem 447 (inclui
Evolution, Sportback e variantes).

### O `vehicle_model` da OLX não serve — e isso quebrava a FIPE

A OLX manda `vehicle_model = "Mitsubishi GT 2.0 16V 160cv Aut."` — com a marca
na frente e **sem a palavra Lancer**. Com isso o casamento com a tabela FIPE
resolveu **3 de 12**.

O título, esse, é regular: `<Marca> <Modelo> <Versão> <Ano>`. `partesDoTitulo()`
tira a marca do começo, o ano do fim, e usa a primeira palavra como modelo:

```
"Mitsubishi Lancer GT 2.0 16V 160cv Aut. 2014"
   → model "Lancer" · version "GT 2.0 16V 160cv Aut."
```

Depois da correção: **FIPE em 12 de 12**. O mais barato da OLX está a **71% da
FIPE** (R$ 44.500, 2013, 79.500 km, Campinas/SP) — o melhor achado do painel
hoje.

### O que foi escrito

| Arquivo | O quê |
|---|---|
| `src/http/browser.js` | **`getPageHtml()`** — transporte genérico: abre uma URL num navegador real e devolve o HTML pronto. O `getSearchPayload()` continua sendo do Webmotors (host fixo, `/api/search/car`, `SEO.Canonical`); a OLX precisa da página, não de interceptar chamada. Os dois dividem rate limiter, contexto persistente e a espera humana no bloqueio |
| `src/adapters/olx.js` | reescrito: `extractAds` (RSC), `extractTotal`, `partesDoTitulo`, `mapAd` novo, `buildPath` sem querystring. `verified: true` |
| `scripts/probe/probe-olx-browser.js` | novo — `npm run probe:olx:browser [url]`, com `--robots`. Aborta em parâmetro proibido |
| `watches.yaml` | `sources: [webmotors, olx]` |

**O `npm run probe:olx` antigo continua lá e continua dando bloqueio** — ele usa
o `fetch` do Node. Isso é esperado, não é regressão. Use o `:browser`.

### Verificado

| Checagem | Resultado |
|---|---|
| Extração contra fixture, sem rede | 57 itens, 50 úteis, 100% Lancer |
| Pipeline completo | 12 gravados, 12 ativos, todos ≤ 100 mil km |
| Recoleta (idempotência) | 2ª rodada: `new: 0`, `vanished: 0` — não duplicou nem sumiu |
| FIPE | 12/12 depois da correção do modelo (era 3/12) |
| `fetch_runs` | duas linhas `OK`, sem erro |

---

## 2-I. 2026-09-09 — Painel: botões por portal, filtro por FONTE e limpeza do topo

Três pedidos do usuário, no mesmo dia da OLX.

### 1. Um botão de coleta por portal

*"separe as coletas de cada portal por botões diferentes para eu não precisar
fazer todas quando quiser testar somente uma delas"*.

O servidor **já aceitava** `source` em `POST /api/collect` desde o começo — era
o painel que só sabia pedir tudo. O que faltava de verdade era saber **qual**
fonte está rodando: `startProgress(source)` agora guarda isso, e o painel pinta
o botão certo quando a página abre no meio de uma coleta.

- Botões: **Coletar tudo** (principal) + um por adapter, vindos de
  `/api/sources` — não repetidos no HTML, senão um dia divergem.
- Todos travam juntos durante uma coleta: o servidor roda **uma** por vez, e um
  segundo clique só receberia "já existe uma coleta em andamento".
- Todo o estado visual (barra, listra indeterminada, spinner, laranja do
  CAPTCHA) virou **classe** `.collect` em vez do id `#collect`, e vale para
  qualquer um dos botões.

### 2. Filtro por FONTE no cabeçalho da tabela

*"na tabela de anúncios ativos já coloca um filtro na palavra FONTE"*. Mesmo
padrão do LOCAL — e o `select` de fontes que ficava no cabeçalho do painel
**saiu**: dois controles para o mesmo filtro é um deles ficando errado.

Os dois menus agora saem de **uma fábrica** (`criarMenuCabecalho`), não de
código duplicado — a diferença entre eles cabe em cinco linhas de configuração.
Abrir um fecha o outro; Esc, rolagem e resize fecham qualquer um, com ouvintes
registrados **uma vez só**, não por menu.

No servidor, `/api/fontes` é irmão de `/api/ufs`: conta por fonte respeitando os
outros filtros. Não devolve a lista de adapters (isso é `/api/sources`), e sim
quem tem anúncio ativo — nenhuma opção leva a tela vazia.

A coluna FONTE foi de 96px para 150px: com `Fonte: Webmotors` no cabeçalho o
texto era cortado.

### 3. Saíram do topo: o chip de falhas e a linha do watch

*"remova esse alerta (…) Webmotors com falhas. Não quero isso no projeto.
Também pode remover esse texto: Mitsubishi Lancer / até 100.000 km /
Webmotors"*. Removidos de `index.html`, `app.js` (`renderAlerta`,
`ICONE_ALERTA`, e `listar`/`dataHora`, que só existiam para ele) e `style.css`
(`.watch`, `#status`, `.chip-alert`, mais a regra responsiva do `.watch`).

`/api/summary` **continua devolvendo `health`** — ninguém consome hoje. É o dado
de que a pendência do "cartão de frescor" precisa, e apagá-lo seria jogar fora o
que falta para ela.

### Verificado no navegador (Playwright, painel de verdade)

| Checagem | Resultado |
|---|---|
| Botões | `(tudo)=Coletar tudo · webmotors=Webmotors · olx=OLX · mercadolivre=Mercado Livre` |
| Clique em **OLX** | só a OLX coletou; os 4 botões travaram; o rótulo virou progresso e voltou a "OLX" no fim |
| Menu FONTE | `todos os portais 76 · Webmotors 64 · OLX 12` |
| Filtrar OLX | 12 linhas, todas `olx`, cabeçalho `Fonte: OLX`, chips de km recontados (1/3/8) |
| Os dois menus compõem | com `fonte=olx`, o LOCAL mostra `RJ 5 · MG 4 · SP 3` = 12 ✓ |
| OLX + RJ | 5 linhas, todas `olx`/`RJ` |
| Abrir um menu | fecha o outro |
| Limpar os dois | volta a 76 |
| Erros de console | **nenhum** |

⚠️ **O painel foi reiniciado** para carregar as rotas novas; conferido em
`/api/summary` que nenhuma coleta estava em andamento antes de derrubar.

### 🔴 Bug que isto criou, e a correção (mesmo dia)

Queixa do usuário assim que o Mercado Livre entrou: *"o título FONTE: MERCADO
LIVRE quebrou a tabela, deixou ela deslocada e com scroll na parte de baixo"*.

Estava certo. `Fonte: Mercado Livre` é bem mais largo que `Fonte: Webmotors`,
não cabia na coluna de 150px e **o cabeçalho ficava mais largo que o corpo** —
daí o desalinhamento e a rolagem horizontal. Com `table-layout: fixed` eu
esperava que o conteúdo fosse cortado; ele transbordou a célula e empurrou a
tabela.

Três mudanças, e a terceira é a que impede o problema de voltar:

1. **A coluna FONTE foi para 168px** (cabe "Mercado Livre" inteiro) e o
   `min-width` da tabela subiu de 1080 para 1140px, que é a soma das colunas
   fixas mais um mínimo decente para ANÚNCIO.
2. **Com filtro ativo, o cabeçalho vira só o valor** — `MERCADO LIVRE`, sem o
   prefixo "Fonte: ". A cor índigo e a seta já dizem que há filtro, e o `title`
   explica por extenso. O LOCAL manteve o prefixo (`Local: SP`), que cabe de
   sobra nos 196px.
3. **O rótulo agora trunca com reticências** (`min-width: 0` no botão +
   `text-overflow: ellipsis` no `<span>`; a seta com `flex-shrink: 0`). É a
   garantia estrutural: qualquer nome futuro corta o texto em vez de quebrar a
   tabela.

**Medido no navegador, com o filtro ativo, em 1500px e 1280px:**

| Medida | Antes | Depois |
|---|---|---|
| Rolagem horizontal da tabela | sim | **não** (`sobra: 0`) |
| Largura do cabeçalho x do corpo | diferentes | **iguais** (1354 / 1234) |
| O botão cabe na célula | não | **sim** (`scroll 168 / client 168`) |

---

## 2-J. ✅ 2026-09-09 — MERCADO LIVRE COLETANDO, SEM TOKEN E SEM CADASTRO

**Resultado, conferido no banco:** `mercadolivre | OK | 14 anúncios | 5,3s`,
todos Lancer ≤ 100 mil km. **As três fontes estão no ar**: 64 Webmotors + 14
Mercado Livre + 12 OLX = **90 anúncios ativos**.

### O cadastro nunca foi necessário para o que o usuário queria

Desde 2026-09-06 o projeto tratava o ML como bloqueado por falta de app
cadastrado. Era verdade **para a API oficial** (`/sites/MLB/search`, 403 sem
token, restrito mesmo com token para apps que não são de vendedor). Mas ninguém
tinha testado o **site público**. Foi o mesmo erro de diagnóstico da OLX, que
ficou três sessões marcada como "bloqueada por Cloudflare" sendo que o problema
era o `fetch` do Node.

```
GET https://lista.mercadolivre.com.br/veiculos/carros-caminhonetes/mitsubishi/lancer/
→ HTTP 200, 1,75 MB, 48 anúncios. Sem token, sem OAuth, sem cadastro.
```

**O código de OAuth continua no projeto** (`src/auth/mercadolivre.js`,
`npm run ml:auth`, `npm run probe:ml`) e não foi tocado. Se um dia a API oficial
for desejada — ela traz câmbio, cor e combustível estruturados, que o card do
site não traz — o caminho está pronto. O adapter é que não depende mais dele.

### ⚠️ O robots.txt do ML barra explicitamente robôs de IA

Isto precisa estar escrito, porque é uma decisão do usuário e não minha.
`lista.mercadolivre.com.br/robots.txt` abre com **sete robôs de IA nomeados**
(os rastreadores das grandes plataformas de IA), todos com a mesma regra:

```
User-agent: <sete rastreadores de IA, um por linha>
Disallow: /
```

Ou seja: **esses crawlers estão proibidos de tudo**. Depois vem a seção
`User-agent: *` (linha 261), sem `Disallow: /`, com as regras normais de filtro.
O arquivo cru está em `data/probe-ml-robots-lista.txt` para quem quiser os nomes.

**O que este projeto faz e por quê:** o coletor não é um crawler de IA. É o
Chromium do próprio usuário, com User-Agent de Chrome, abrindo **uma página por
dia** do carro que ele quer comprar — o mesmo que ele faria à mão. Por isso as
regras aplicadas são as de `User-agent: *`, e elas são respeitadas ao pé da
letra (ver abaixo). Fica registrado para o usuário decidir; se ele preferir
tirar o ML, é `sources:` no `watches.yaml` e mais nada.

### O que o `User-agent: *` proíbe — e que a gente respeita

| Padrão proibido | O que é |
|---|---|
| `/*_Desde_` | **paginação** |
| `/*_PriceRange_` | faixa de preço |
| `/*_OrderId_` | ordenação |
| `/*_FilterId_`, `/*_OtherFilterID_` | filtros em geral |
| `/*_NoIndex_True` | páginas marcadas para não indexar |
| `/*_CarDealer_` | filtro de concessionária |

São **segmentos de caminho**, não querystring — mas a proibição vale igual. O
caminho `/veiculos/carros-caminhonetes/<marca>/<modelo>/` não está na lista, e é
esse que o adapter usa. Km, preço e ano continuam sendo recortados pelo
`matchesWatch`, depois da coleta. **Terceira fonte seguida com a mesma regra**
(Webmotors 2-D, OLX 2-H).

Consequência: **uma página por coleta**, 48 anúncios. Paginar exigiria
`_Desde_51`.

### Onde estão os dados: HTML puro, nem `__NEXT_DATA__` nem RSC

O probe mediu as pistas: `__PRELOADED_STATE__` 0 · `self.__next_f` 0 ·
`ld+json` 1 (vazio de anúncios) · **`ui-search-layout__item` 49**. A busca do ML
é HTML renderizado no servidor. Cada anúncio é um `<li>` com título, preço, ano,
km e cidade.

`extractItems()` é **função pura**: recebe HTML, devolve objetos — dá para
testar contra `data/probe-ml-browser.html` sem rede. É casca de site, a coisa
mais frágil que existe; aceitável porque adapter é peça descartável, e
`npm run probe:ml:browser` mostra na hora se as classes sumiram.

### Quatro detalhes de mapeamento que custaram teste

1. **O estado vem por extenso.** "Brasília - Distrito Federal". O `parseUf()` só
   reconhece sigla de duas letras, então **todos** os anúncios do ML ficariam
   sem UF — e sumiriam do filtro LOCAL. Tabela `UF_POR_NOME` no adapter resolve.
2. **Marca, modelo e versão saem do título**, como na OLX — mas aqui o **ano
   fica no meio**: `"Mitsubishi Lancer 2019 2.0 Hl-t 16v..."`. Sem isso a FIPE
   não resolveria nada (ela exige marca + modelo).
3. **Câmbio e combustível não existem no card** — só dentro do anúncio, que
   custaria uma requisição por carro. São derivados do título (`Cvt`, `Aut.`,
   `Mec.`), como o Webmotors já faz com combustível. Ficam nulos em 2 dos 14
   quando o título não diz.
4. **O preço tem duas formas no HTML**: `aria-label="53000 reais"` (número
   limpo) e a fração `"53.000"`. Lemos a primeira, com a segunda de reserva.

### Verificado

| Checagem | Resultado |
|---|---|
| Extração contra fixture, sem rede | 48 itens, 0 campos essenciais nulos |
| Pipeline completo | 14 gravados, 14 ativos, **maior km 100.000** |
| `fetch_runs` | `mercadolivre OK 14 5267ms` |
| FIPE | **11 de 14** — os 3 que faltam são versão genérica ("2.0 Cvt 4p") que o `bestMatch` não casou na tabela; não é falha de coleta |
| UF | 10 estados distintos reconhecidos (DF, MG, SP, PR, RS, SC, RJ, ES, GO, BA) |
| Painel, com as 3 fontes | menu FONTE: `Webmotors 64 · Mercado Livre 14 · OLX 12` = 90; filtrar ML → 14 linhas; LOCAL dentro de ML → SP 7 · RJ 3 · SC 2 · ES 1 · PR 1 = 14 ✓; 0 erros de console |

### Correção de regra: o `probe:ml` usava `fetch` cru

`scripts/probe/probe-ml.js` chamava `fetch()` direto contra
`api.mercadolibre.com`, contra a regra do projeto ("vale para probes e scripts
descartáveis também" — foi um `fetch` cru que derrubou o Webmotors por 21h em
2026-09-06). Passou a usar `getJson`, com rate limiter e `HttpError`.

**Ainda restam dois `fetch` crus**, os dois no fluxo de OAuth do ML:
`src/auth/mercadolivre.js:53` (troca de token) e `scripts/ml-auth.js:90`
(`/users/me`). **Não mexi de propósito**: é código que nunca foi executado (não
há credenciais), e trocar transporte às cegas num fluxo que não dá para testar
troca um problema conhecido por um desconhecido. Fica registrado como dívida —
se o usuário for cadastrar o app, corrigir junto.

### Observação para decidir depois

Os chips de **câmbio somam 88**, enquanto os de km somam 90: dois anúncios do ML
não têm câmbio (o título não diz). Os chips só contam quem tem o campo — é o
comportamento antigo, que nunca aparecia porque Webmotors e OLX sempre mandam
câmbio. Se incomodar, cabe um chip "sem informação", na mesma linha do balde
`outro`. **Não fiz**: o usuário não pediu e a diferença é honesta.

---

## 2-K. 2026-09-10 — Ordenação por clique no cabeçalho (ANO, KM, PREÇO, FIPE)

Pedido do usuário: *"clicar na palavra PREÇO: 1 clique organiza por preço
crescente, mais um clique inverte"* — e, logo depois, *"faça esse mesmo tipo de
filtro por Ano, Km, Fipe"*.

### A decisão que evitou 9 opções no select

O painel já tinha um `select` de ordenação ("menor % da FIPE", "menor preço",
"menor km", "mais recentes"). Quatro colunas × duas direções + recentes = **9
combinações**, e um `select` com nove linhas seria pior do que o problema.

Então os dois controles foram divididos por responsabilidade, com **um estado
só** (`ordem = { campo, dir }`):

| Controle | Escolhe |
|---|---|
| `select` do topo | o **critério** (FIPE, preço, km, ano, mais recentes) |
| clique no cabeçalho | o **critério + a direção** (1º clique crescente, outro inverte) |

O `select` continua existindo porque **"mais recentes" não tem coluna para
clicar**. E os dois nunca discordam porque leem e escrevem o mesmo objeto — foi
exatamente por discordarem que o antigo `select` de fontes saiu quando o menu
FONTE entrou (seção 2-I).

Trocar o critério pelo `select` recomeça em **crescente**: é o que se espera de
um primeiro clique ("do menor para o maior").

### No servidor

`orders` passou de 4 para 9 entradas — `fipe`, `preco`, `km`, `ano`, cada um com
seu `_desc`, mais `novos`. E **todas** ganharam `<campo> IS NULL` na frente:

```sql
preco:      'l.price IS NULL, l.price ASC'
preco_desc: 'l.price IS NULL, l.price DESC'
```

Sem isso, um anúncio sem preço encabeçaria a lista de "menor preço" só por ser
nulo. `sort` desconhecido continua caindo em `novos`, sem erro.

### No painel

Os quatro cabeçalhos são botões (`.ordena[data-campo]`) que ocupam a célula
inteira, com **um handler para os quatro**. A seta acende só na coluna que manda
(as outras ficam em `opacity: .25`, o suficiente para dizer "dá para clicar"), e
o triângulo base aponta para baixo — crescente é ele virado 180°.

Reaproveitou o `.th-btn` dos menus de LOCAL/FONTE, com o modificador
`.th-btn--num` para encostar o conteúdo à direita, como os números da coluna.

### Verificado no navegador, coluna a coluna

Cada uma clicada duas vezes, conferindo se os valores realmente saem em ordem:

| Coluna | 1º clique (crescente) | 2º clique (decrescente) |
|---|---|---|
| ANO | 1993 · 2001 · 2010 · 2010 ✔ | 2019 · 2019 · 2019 ✔ |
| KM | 109 · 115 · 20.000 · 23.455 ✔ | 100.000 · 100.000 · 99.500 ✔ |
| PREÇO | 44.500 · 45.000 · 49.900 ✔ | 549.900 · 400.000 · 360.000 ✔ |
| FIPE | -29,1% · -21,7% · -16,0% ✔ | +1025% · +624% · +140,5% ✔ |

Mais: só uma seta acesa por vez ✔ · o `select` acompanha o clique ✔ · o clique
acompanha o `select` ✔ · a ordenação sobrevive a um filtro de fonte ✔ ·
**0 erros de console** ✔.

### 🎉 A primeira rodada COMPLETA com as três fontes

Enquanto isto era escrito, o usuário clicou em **"Coletar tudo"** às 00:03 —
e foi a primeira vez que a rodada inteira rodou com os três portais:

```
webmotors     OK  64  298395ms   <- 5 minutos, 9 paginas
olx           OK  12    1262ms
mercadolivre  OK  13    2581ms
```

**O Webmotors sozinho é 98% do tempo da coleta.** OLX e ML custam ~4 segundos
somados, porque são uma página cada (limite do robots.txt das duas).

Um anúncio do ML saiu do ar entre 23:44 e 00:03 (`DISAPPEARED`, Mogi Guaçu,
R$ 70.790) — o ciclo de vida completo funcionando: entrou como `NEW`, sumiu do
resultado, virou `active = 0` e evento no painel. Total: **89 ativos**.

---

## 2-L. 2026-09-10 — Teto de preço no painel e correção do km digitado em milhares

Dois pedidos do usuário: *"carros acima de 100.000 reais nem devem mais aparecer
no nosso interface"* e *"carros com a quilometragem de 3 dígitos, como 109 e
115, provavelmente foi erro de digitação e o carro deve ter 109000 e 115000"*.

**São coisas de naturezas diferentes, e por isso foram para lugares diferentes:**
o preço é **recorte de exibição** (o dado está certo, só não interessa ver); o km
é **dado errado**, e dado errado se conserta na entrada.

### 1. Teto de preço (e de km) — exibição, não coleta

`src/core/panelLimits.js`, novo, com `tetosDoPainel()`. Configurável:

```
PANEL_PRICE_MAX=100000    # 0 desliga
PANEL_KM_MAX=100000
```

**Por que não pôr `price_max: 100000` no `watches.yaml`**, que seria o lugar
óbvio: isso mudaria o *recorte da coleta*, e os 17 anúncios acima do teto que já
estão no banco deixariam de bater com o watch na próxima rodada. Como
`findVanished()` marca como sumido tudo que estava ativo e não voltou, eles
virariam **17 eventos falsos de "saiu do ar"** — para carros que continuam
anunciados. Teto de exibição não tem esse efeito: o anúncio continua sendo
coletado, mantém histórico de preço, e mudar de ideia é editar uma linha do
`.env`, sem recoletar nada.

**O teto vale em quatro consultas, não em uma.** Foi o erro da primeira versão:
filtrei só `/api/listings` e o painel passou a se contradizer — cartão dizendo
**"89 anúncios ativos"** com **70 linhas** na tabela logo abaixo. Por isso o
módulo existe, em vez de duas linhas de SQL copiadas:

| Onde | Por quê |
|---|---|
| `filtrosComuns()` | a lista **e** as contagens dos chips e dos menus LOCAL/FONTE |
| `/api/summary` | os cartões do topo contam o mesmo universo da tabela |
| `recentEvents()` | não adianta esconder o Evolution e anunciar a baixa de preço dele em "O que mudou" |
| `pendingNotifications()` | quem não quer ver não quer ser acordado no Telegram |

`IS NULL OR` em ambos os tetos: preço ou km **desconhecido** não é motivo para
esconder — some quem comprovadamente estoura.

### 2. `corrigirKm()` — o anunciante que digita em milhares

Em `src/core/normalize.js`, aplicado no `toListing()`, junto do resto da limpeza
de dado sujo. Não é derivado na leitura como o `kmBand()`, e de propósito: km
errado envenena o filtro de faixa, a ordenação por km e o próprio
`matchesWatch` — coisas que acontecem longe do painel.

A regra tem **duas travas**, e as duas existem para não estragar dado bom:

| Trava | Por quê |
|---|---|
| carro com **2 anos ou mais** | um carro do ano **pode** ter 109 km de verdade |
| resultado **≤ 400.000 km** | senão `800` viraria 800.000 km, tão implausível quanto o original — e quando a correção não é claramente certa, o certo é não mexer (800 tanto pode ser 8.000 quanto 80.000) |

Testado caso a caso:

```
  115 ano 2015 ->  115000   (caso real)      109 ano 2026 ->     109  (carro do ano)
  109 ano 2016 ->  109000   (caso real)      800 ano 2020 ->     800  (nao mexe)
   45 ano 2013 ->   45000                    401 ano 2015 ->     401  (implausivel)
```

O valor cru continua em `listings.raw`, então a correção é reversível.

### As duas linhas que já estavam no banco

Corrigidas rodando **a própria `corrigirKm()`** sobre elas — nada de `UPDATE`
com número cravado, senão a regra passaria a existir em dois lugares:

```
67  webmotors  Lancer 2015   115 -> 115000 km
216 olx        Lancer 2016   109 -> 109000 km
```

E aí **foram desativadas na mão, sem evento**. Motivo: com o km certo elas estão
fora do recorte do watch (109 mil > 100 mil), então na próxima coleta o
`findVanished()` as marcaria como sumidas e criaria dois **"saiu do ar" falsos**
— os carros continuam anunciados. `active = 0` aqui significa "não está mais no
nosso recorte", que é verdade. Como o teto de km já as escondia, nada mudou na
tela.

### Verificado

| Checagem | Resultado |
|---|---|
| Cartão x tabela | **70 e 70** (era 89 x 70 antes da correção do resumo) |
| Anúncio mais caro visível | **R$ 99.900** |
| Menor km visível | **23.455** (os 109/115 sumiram) · maior: 100.000 |
| Contagens batem com a lista | fontes 47+13+10 = 70 ✓ · faixas 5+11+54 = 70 ✓ · UFs 44+12+4+4+2+1+1+1+1 = 70 ✓ |
| Eventos | 0 eventos de carro acima de qualquer um dos tetos |
| Escondidos | 17 por preço (16 Webmotors + 1 OLX) e 2 por km |
| Erros de console | nenhum |

### Efeito colateral conhecido

O chip **"acima de 100 mil"** da linha de km agora é sempre 0 — o teto de
exibição garante isso. Não removi: se o usuário puser `PANEL_KM_MAX=0`, o chip
volta a fazer sentido sozinho. Se incomodar, a linha de chips de câmbio já tem o
padrão pronto (só mostra grupo com contagem > 0).

---

### Ícone da aba (favicon): carro + lupa

Pedido do usuário: *"coloca um ícone de carro e lupa na aba do nosso site"*.

`public/favicon.svg` (1,8 KB) + `favicon.png` de reserva, linkados no `<head>`.
SVG porque a aba pede 16px e bitmap desse tamanho fica sujo.

**Duas versões foram jogadas fora antes desta**, e o motivo vale registrar: um
favicon não se avalia no editor, se avalia **renderizado a 16px**. Montei uma
folha de prova (Playwright renderizando o SVG a 16/32/64/128px sobre fundo claro
e escuro) e só aí os defeitos apareceram:

1. **1ª versão** — lupa grande no centro: engolia o carro, e a 16px sobrava só
   um anel verde. Corrigido invertendo a hierarquia: o carro ocupa a largura
   toda e a lupa virou acento no canto.
2. **2ª versão** — o cabo da lupa aparecia **solto**, como uma vírgula ao lado
   da lente. O cabo era desenhado ANTES do anel, e o contorno escuro do anel
   cobria a emenda. Corrigido desenhando o cabo por último.
3. Cabine e corpo do carro tinham tons próximos de índigo e viravam um borrão a
   16px — a cabine foi para `--indigo-3`, bem mais clara.

O ícone tem **fundo próprio** (retângulo arredondado na cor da barra do painel):
aba de navegador pode ser clara ou escura, e ícone sem fundo some numa das duas.

Conferido: `/favicon.svg` → 200 `image/svg+xml`, o Chromium pede e decodifica,
e o `<head>` tem os dois links.

---

## 2-M. 2026-09-10 — O projeto foi para o GitHub (repositório público)

`https://github.com/SonyMainardi/consulta-carros` — 51 arquivos, 485 KB, branch
`main`, commit `535d8ee`. **O projeto não era um repositório git até agora**;
`git init` foi feito nesta sessão.

### O `.gitignore` foi refeito antes do push

O que já estava lá (`.env`, `node_modules/`, `data/browser/`, `data/cookies/`,
`logs/*.log`) cobria o básico. Faltavam três coisas, e as três doem:

| Acrescentado | Por quê |
|---|---|
| `data/*` (com `!data/.gitkeep`) | `ml-tokens.json` (access + refresh token do ML, que **ainda não existe** mas apareceria no dia em que o usuário rodar `npm run ml:auth`), e 3,4 MB de fixtures que são **cópias de páginas de terceiros** — anúncios, fotos e vendedores. São regeneráveis pelos probes |
| `.env.*` com `!.env.example` | qualquer `.env.producao`, `.env.local` que venha a existir |
| lixo de SO/editor | `.DS_Store`, `Thumbs.db`, `desktop.ini`, `.vscode/`, `.idea/`, `*.swp` |

⚠️ **Pegadinha de git que quase passou:** `data/` seguido de `!data/.gitkeep`
**não funciona** — quando o diretório inteiro é excluído, o git nem entra nele
e a negação nunca é avaliada. Só funciona com `data/*`. Foi pego conferindo o
stage, não depois.

### O `.env.example` estava perigoso para quem clonasse

Ele não tinha **nenhuma** das variáveis do navegador (`HTTP_USE_BROWSER`,
`BROWSER_HEADLESS`) e trazia `HTTP_MIN_INTERVAL_MS=12000`. Ou seja: quem
clonasse o repositório e copiasse o exemplo sairia batendo nas fontes **com o
`fetch` do Node, a cada 12 segundos** — exatamente a receita que derrubou o
acesso ao Webmotors por 21h em 2026-09-06. Corrigido para 60000 + 20000 de
jitter, `HTTP_USE_BROWSER=true`, `BROWSER_HEADLESS=false` e `COLLECT_CRON`
igual ao de uso real.

### Auditoria antes do push (e depois)

| Checagem | Resultado |
|---|---|
| Arquivos no commit | 51, 485 KB |
| `.env` no stage | não |
| `data/` no stage | só `data/.gitkeep` |
| Segredo literal no diff | nenhum (só `config.ml.clientSecret`, que lê do env) |
| `.env.example` | todos os campos de credencial vazios |
| Confirmado **no GitHub**, via API | `.env`, `data/browser`, `data/cookies`, `data/ml-tokens.json`, `logs`, `node_modules` e os fixtures → **404 em todos** |

### Pendência que o push revelou — RESOLVIDA no mesmo dia (commit `dc365b8`)

O `README.md` era de 2026-09-06 e virou a porta de entrada de um repositório
público dizendo o que não vale mais: que o Mercado Livre "exige token" (não
exige — 2-J), que a OLX usa `__NEXT_DATA__` (virou stream RSC — 2-H) e que o
Playwright "pode" ser necessário (é obrigatório nas três).

O usuário pediu a atualização com **as instruções de execução no começo**.
Reescrito: abre com "Como rodar" em seis passos numerados, do `git clone` até a
conferência da primeira coleta em `fetch_runs` — incluindo o que esperar
(janela do Chromium, ~5 min no Webmotors, ~4s nas outras duas, e o que fazer se
aparecer CAPTCHA). Documenta também o que nunca existiu no README: filtros de
estado e portal, ordenação por clique no cabeçalho, botão por portal, tetos de
exibição e os probes via navegador.

**Duas afirmações foram medidas antes de escrever**, em vez de chutadas:

- *"`npm run collect olx` repassa o argumento?"* — sim. O npm costuma exigir
  `--`, então testei com um script temporário: nesta versão (npm 11) as duas
  formas passam `["olx"]`. O script de teste foi removido e **não foi commitado**.
- *"quantas páginas o Webmotors leva?"* — o comentário do código dizia 9; o log
  de 2026-09-10 diz **5** (`pagina 5/5: 208 de 208`). O README diz 5.

---

## 2-N. 2026-09-10 — Repositório refeito do zero, sem assinatura de ferramenta

O usuário apagou o repositório anterior e criou outro com o mesmo nome, com um
pedido explícito: **nenhuma menção à ferramenta de IA usada na máquina**, em
lugar nenhum do projeto.

### O que causava a menção

Os quatro commits antigos terminavam com um trailer `Co-Authored-By:`. O GitHub
lê esse trailer e passa a mostrar **um segundo avatar na página de cada commit**.

Vale registrar o diagnóstico completo, porque o susto era maior que o fato:

| Onde | Antes |
|---|---|
| Aba **Contributors** | só o usuário — a ferramenta **nunca** apareceu ali |
| Campos `author` e `committer` | `Sony Mainardi <sonylethor@gmail.com>` nos dois |
| Página de cada commit | aí sim: dois nomes, por causa do trailer |

### O que foi feito

1. **`.git` apagado e refeito.** Histórico novo, **um commit só**, sem trailer
   nenhum. Era mais limpo do que reescrever as mensagens antigas com
   `filter-branch` e dar force-push.
2. **Varredura nos arquivos**, não só nos commits — era onde estava a parte
   invisível do problema:
   - o arquivo de instruções da ferramenta local (7,6 KB, continua no disco)
     saiu do repositório;
   - o cabeçalho deste `ESTADO.md` dizia "se você é o … retomando este projeto";
     virou "se você está retomando este projeto depois de um tempo";
   - um link de relatório publicado foi removido da seção 2-F;
   - o `README.md` deixou de citar o arquivo de instruções na lista de docs;
   - as citações de `robots.txt` que **nomeavam rastreadores de IA** (seções 2-D
     e 2-J) foram reescritas: o fato continua ("sete robôs de IA levam
     `Disallow: /`, e a seção `User-agent: *` é outra"), sem os nomes. Os
     arquivos crus em `data/probe-*-robots*.txt` têm os nomes para quem precisar.
3. **O arquivo de instruções ficou fora via `.git/info/exclude`, não pelo
   `.gitignore`.** Detalhe que importa: o `.gitignore` é versionado, então
   escrever o nome do arquivo lá seria *publicar a menção* que se queria evitar.
   O `.git/info/exclude` é local e nunca sai da máquina.

### Verificado depois do push

| Checagem | Resultado |
|---|---|
| Trailer no commit | nenhum |
| `author` / `committer` no GitHub | `Sony Mainardi` |
| Co-autor na API de commits | nenhum |
| Contributors | só `SonyMainardi`, 1 commit |
| Busca pelo nome da ferramenta (e da empresa) em **todos os 51 arquivos** versionados | **zero ocorrências** |

**Pegadinha:** a primeira versão desta seção **reintroduziu a palavra** ao
descrever a própria varredura (`Busca por "..." em 51 arquivos`). A checagem
acusou, e a linha foi reescrita sem citar os termos. Vale para quem for
documentar isso de novo: descrever a busca é fácil de esquecer.

### Para as próximas sessões

**Não assine commits deste projeto.** Nada de `Co-Authored-By`, nada de link de
sessão, nada de menção à ferramenta em arquivo versionado — foi pedido direto do
usuário, vale de agora em diante.

---

## 2-O. 2026-09-10 (sessão 7) — o projeto foi subido localmente e conferido

Pedido do usuário: *"rode nosso projeto localmente"*. Nada de código mudou —
esta seção registra o que foi verificado ao subir.

**Como subiu:** `npm start` em `D:\Consulta de Carros`, com o `.env` que já
estava lá (`PORT=3000`, `COLLECT_ON_BOOT=false`, `COLLECT_CRON=0 9 * * *`,
`HTTP_USE_BROWSER=true`, `BROWSER_HEADLESS=false`).

**Estado do ambiente na hora:** serviço `MySQL80` **Running**, porta 3000
livre, Node v24.16.0.

**Verificado de verdade** (não pela tela — pelo banco e pelas rotas):

| Checagem | Resultado |
|---|---|
| `GET /` | HTTP 200, 7.438 bytes |
| `GET /api/summary` | 75 no total, **70 ativos** (depois dos tetos de 2-L), 25 novos em 24h |
| `GET /api/listings?sort=fipe` | devolve linhas; a mais barata em relação à FIPE é uma OLX 2013, 79.500 km, R$ 44.500 (**0,709**) |
| `GET /api/fontes` | webmotors 47 · mercadolivre 13 · olx 10 |
| `fetch_runs` (últimas 3) | `mercadolivre OK 13` · `olx OK 12` · `webmotors OK 64` — todas de **2026-09-10 00:03**, a rodada da sessão anterior |

Ou seja: o painel está mostrando a coleta das 00:03, **não** uma coleta nova —
subir o servidor não coleta nada, porque `COLLECT_ON_BOOT=false`. Continua
valendo o aviso do topo: número no painel não é prova de coleta; a prova é
`fetch_runs`.

**Uma observação nova, pequena:** o servidor levou **~60 segundos** entre o
`npm start` e o `painel em http://localhost:3000` no log. Nesse intervalo a
porta 3000 ainda não estava escutando e o navegador dá "conexão recusada" — não
é erro, é só a subida. Quem for testar logo depois de iniciar: espere o log
dizer `painel em ...` antes de concluir que falhou.

**A coleta das 9h de hoje:** o servidor só subiu às 12h05, então a rodada
agendada das 9h não tinha ninguém de pé para disparar — é exatamente o problema
já registrado em 2-G, e a 3ª vez que acontece. O agendador só existe enquanto
`npm start` estiver rodando.

---

## 2-P. 2026-09-15 (sessão 8) — Exportar os anúncios ativos (CSV com links)

Pedido do usuário: *"exportar os anuncios da tabela de ativos na visualização
que ele estiver vendo com os links tambem"*.

### O que entrou

Botão **Exportar CSV** no cabeçalho do painel "Anúncios ativos", ao lado do
select de ordenação (`#export` em `public/index.html`, `.btn-export` no
`style.css`, `exportarCsv()` no `app.js`). **Nenhuma rota nova no servidor.**

### A decisão: exportar as linhas que JÁ estão na tela

O `loadListings()` guarda o que desenhou em `linhasVisiveis`, e a exportação lê
dali. Não faz nova chamada à API. Com isso, o arquivo é **exatamente** a tabela:
mesmos filtros (km, câmbio, LOCAL, FONTE), mesma ordem (critério + direção),
mesmo limite de 200 e mesmos tetos de exibição de 2-L. Uma rota de exportação
separada teria de repetir tudo isso, e um dia as duas sairiam de sincronia.

O botão fica **desabilitado** quando a tabela está vazia, e o `title` diz
quantos anúncios vão sair.

### Formato — pensado para o Excel em português

| Escolha | Por quê |
|---|---|
| separador `;` | o Excel pt-BR usa a vírgula como decimal e não separa por ela |
| BOM UTF-8 no início | sem ele "Câmbio" e "São Paulo" viram lixo no Excel |
| KM e preço como número cru (`98000`, `49900`) | dá para somar e ordenar na planilha |
| FIPE com vírgula decimal (`-21,7`) | idem |
| título que começa com `= + - @` ganha `'` na frente | título é texto de terceiro; senão o Excel o executaria como **fórmula** |

Colunas: Anúncio · Ano · KM · Faixa de km · Câmbio · Preço (R$) · FIPE (%) ·
Cidade · UF · Fonte · **Link**. O link vai em coluna própria, como texto: o
Excel não o torna clicável sozinho num CSV. Fórmula `HIPERLINK` foi descartada
porque o nome e o separador dela mudam com o idioma do Excel.

Nome do arquivo = a visualização: `anuncios_<data>_<fonte>_<uf>_<faixa>_<cambio>_ordem-<campo>[-desc].csv`
(só entram os filtros ativos). Ex.: `anuncios_2026-09-15_olx_ordem-preco-desc.csv`.

### Dois erros achados antes de entregar

1. **Preço saía `49900.00`.** A coluna é `DECIMAL` e o mysql2 a devolve como
   texto; o Excel pt-BR leria o ponto como separador de milhar. Agora é
   arredondado para inteiro (anúncio não tem centavos).
2. **O `'` anti-fórmula pegaria o `-21,7` da FIPE**, que começa com `-`. Número
   com vírgula passa sem apóstrofo.

### Verificado no navegador, com o servidor que já estava de pé

O download foi interceptado (blob lido direto na página) e comparado com a
tabela renderizada:

| Visualização | CSV | Tabela | Ordem e links iguais |
|---|---|---|---|
| padrão (ordem FIPE) | 68 linhas | 68 | ✔ |
| FONTE = OLX, PREÇO decrescente | 13 linhas | 13 | ✔ (77890 · 72790 · 67900…) |

Mais: BOM presente ✔ · 11 colunas em todas as linhas (nenhum `;` quebrou
coluna) ✔ · só OLX no filtro de OLX ✔ · nome do arquivo com filtro e ordem ✔ ·
**0 erros de console** ✔. **Não conferido:** abrir o arquivo no Excel de fato.

> ⚠️ **Substituído no mesmo dia pela seção 2-Q** — o CSV saiu; o botão agora
> gera `.xlsx`. O que continua valendo daqui: a exportação lê `linhasVisiveis`
> (a tela), não a API.

---

## 2-Q. 2026-09-15 (sessão 8) — O CSV virou planilha .xlsx (largura certa e link clicável)

Pedido do usuário, logo depois do 2-P: *"ajustar as colunas para que as
informações não sejam cortadas, a não ser a coluna de links… ele só quer clicar
nos links… deixar bem organizado"*.

### Por que saiu do CSV

CSV é só texto: **não guarda largura de coluna nem link clicável.** As duas
coisas pedidas eram impossíveis no formato. Então o botão virou **Exportar
planilha** e gera `.xlsx`.

### Sem dependência nova

O painel é HTML estático, sem build. Um `.xlsx` de uma aba com estilos fixos é
um ZIP sem compressão com sete XMLs, e coube em `public/xlsx.js` (~250 linhas,
CRC32 + ZIP "store" + planilha). Dois módulos novos, **nenhum toca no DOM**:

| Arquivo | Papel |
|---|---|
| `public/xlsx.js` | genérico: recebe colunas tipadas + linhas, devolve os bytes do `.xlsx` |
| `public/exportar.js` | as 11 colunas da planilha de anúncios (rótulos com acento) |
| `public/app.js` | só o que é da tela: `linhasVisiveis`, filtros, ordem, nome do arquivo, download |

Por não tocarem no DOM, dá para gerar a planilha **no Node com dado real** e
abrir no Excel — foi como ela foi validada.

### Como ficou a planilha

- **Linha 1:** descrição da visualização, em itálico — ex.: *"Anúncios ativos:
  39 anúncios · estado São Paulo · ordem: km (crescente) · exportado em
  15/09/2026 às 15:44"*. Quem abrir o arquivo dias depois sabe que recorte é.
- **Linha 2:** cabeçalho em negrito branco sobre o índigo do painel, **congelado**
  e com **autofiltro**.
- **Largura de cada coluna calculada pelo conteúdo** (pelo texto como o Excel o
  exibe — "R$ 549.900", não 549900), com erro proposital para cima.
- **Números são números:** KM `41.000`, preço `R$ 77.890`, FIPE `-21,7%` em
  verde / `+5,2%` em vermelho — por formato de célula, então somam e ordenam.
- **Link:** a célula mostra **"Abrir anúncio"**, azul sublinhado e clicável; a
  URL fica no link (e no balão ao passar o mouse). Largura fixa no rótulo.
- Título de anúncio vai como texto inline: **não existe risco de fórmula** no
  `.xlsx` (no CSV existia). Caracteres de controle são removidos — um só, num
  título, faria o Excel recusar o arquivo inteiro.

### Três erros achados pela validação no Excel (via COM, `Excel.Application`)

1. **Folga do cabeçalho pequena demais.** Com +4 caracteres, "Ano", "UF",
   "Câmbio" e "Faixa de km" ficavam encostados no botão do filtro. A primeira
   checagem tinha tolerância de 2 e **mascarou** isso; refeita sem tolerância.
2. **Cabeçalho centralizado precisa de folga dos dois lados** (+9, não +6).
3. **Cabeçalho alinhado à direita fica embaixo do botão do filtro.** Na foto da
   janela do Excel, "KM" aparecia "K", "Preço" "Pre", "FIPE" "FI". **O AutoFit do
   Excel não conta o botão**, então só a foto mostrou. Solução: cabeçalho de
   coluna numérica é **centralizado** (os centralizados já estavam perfeitos na
   mesma foto).

Mais um, de ferramenta: o `Write` gravou os ` …` da regex de limpeza
como **bytes de controle crus** no `xlsx.js` (o `grep` passou a chamar o arquivo
de binário). Funcionava, mas era frágil; reescritos como escapes `\uXXXX`.

### Verificado

| Checagem | Resultado |
|---|---|
| Excel abre sem reparo | ✔ dois arquivos (padrão 69 linhas, OLX/preço-desc 13) |
| painel congelado na linha 2 · autofiltro · nº de links | ✔ · ✔ · 69 e 13 |
| largura ≥ AutoFit do Excel (dado e cabeçalho + botão) | ✔ nenhuma coluna corta |
| título hostil `=HYPERLINK("x") <b>&"teste"</b>` + caractere de controle | ✔ virou texto, `HasFormula = False` |
| URL com `&` na querystring | ✔ link íntegro |
| botão no painel (navegador): padrão e LOCAL=SP + ordem KM | ✔ 68 e 39 links, **mesma ordem e mesmas URLs da tabela**, nome `…_SP_ordem-km.xlsx`, 0 erros de console |

**Não conferido a olho depois da última correção** (cabeçalhos numéricos
centralizados): a 2ª foto pegou outra janela que estava na frente do Excel, e
foi descartada. A correção reusa o estilo que a 1ª foto mostrou funcionando.
Scripts de validação ficaram no scratchpad da sessão, não no projeto.

---

## 2. Status geral

O sistema sobe e **o Webmotors já entrega dados reais**. ML e OLX seguem
`verified: false` — ver seção 2-A para o quadro atual de cada fonte.

### O que está verificado funcionando

| Item | Como foi verificado |
|---|---|
| Os 14 módulos importam sem erro | loop de `import()` em cada arquivo |
| Servidor sobe e serve o painel | `GET /` → 200, `GET /style.css` → 200 |
| Rotas da API respondem | `GET /api/sources` → `["mercadolivre","webmotors","olx"]` |
| Agendador cron ativa | log `agendador ativo: 7 * * * *` |
| Parsing de dados sujos | `"R$ 89.900,00"`→`89900`; `"2019/2020"`→`{fab:2019,model:2020}`; `"45.000 km"`→`45000`; `"São Paulo - SP"`→`SP` |
| 0 vulnerabilidades npm | `npm audit` limpo (subimos para Express 5 e node-cron 4 por causa disso) |
| ML sem token devolve 403 | `npm run probe:ml` → `{"message":"forbidden","status":403}` |

### O que NÃO está verificado (importante)

- ~~Os três adapters~~ → **os três verificados e coletando de verdade** em
  2026-09-09 (Webmotors 2-E, OLX 2-H, Mercado Livre 2-J).
- **Se a API oficial do ML libera o search COM token** — segue incógnita, e hoje
  não importa: a coleta do ML passa pelo site público, sem token. Sem token o
  `/sites/MLB/search` dá 403 (confirmado em 2026-09-06).
- ~~O banco~~ → **migration e seed rodaram em 2026-09-07**; 66 anúncios gravados.
- O fluxo `npm run ml:auth` (escrito, nunca executado — precisa de credenciais).
- **As notificações** (`src/notify/`) — escritas, `NOTIFY_ENABLED=false`, nunca
  dispararam uma única vez.
- **A coleta agendada das 9h** — o cron ativa (visto no log), mas nunca chegou a
  disparar uma rodada de verdade.

---

## 3. Bloqueios: NÃO HÁ NENHUM

~~`DB_PASSWORD` vazio~~ — **resolvido em 2026-09-07.** Banco criado, populado,
coleta rodando. Nada trava o projeto hoje.

Configuração em uso (conferida lendo `config.js`, não só o `.env`):

| Chave | Valor | Por quê |
|---|---|---|
| `COLLECT_CRON` | `0 9 * * *` | uma coleta por dia; o usuário concordou que basta |
| `HTTP_USE_BROWSER` | `true` | sem isso o PerimeterX barra na 1ª requisição |
| `BROWSER_HEADLESS` | `false` | **não mude.** headless é detectado, e alguém precisa poder resolver o CAPTCHA |
| `HTTP_MIN_INTERVAL_MS` | `60000` | + `HTTP_JITTER_MS=20000` → 60-80s por página |

`ML_CLIENT_ID`/`ML_CLIENT_SECRET` seguem vazios — opcional, o Webmotors não
precisa de credencial nenhuma.

⚠️ **O agendador só dispara com o servidor de pé** (`npm start`). Se a máquina
for desligada à noite, a coleta das 9h não acontece.

---

## 4. Próximos passos, em ordem

O básico está pronto e funcionando. Daqui em diante é melhoria, não construção.

1. **Avisar o usuário quando um CAPTCHA travar a coleta desacompanhada.**
   É a lacuna mais concreta. A rodada das 9h expira em 5 min se ninguém resolver,
   e o alerta atual só existe para quem está com o painel aberto. O código de
   Telegram já existe (`src/notify/telegram.js`, `NOTIFY_ENABLED=false`, nunca
   testado) — falta ligar em `setNeedsHuman`. Já oferecido ao usuário; **ele
   ainda não respondeu.**

2. **Testar as notificações de verdade** (novo anúncio, baixa de preço). Nunca
   rodaram. Depende de o usuário criar o bot no @BotFather.

3. **Conferir se o `matchesWatch` está deixando passar o que deve.** A busca traz
   Evolution X e Sportback Ralliart, que são "Lancer" mas outra faixa de preço
   (um deles a R$ 212.000). Não é bug — decidir com o usuário se quer separar.

4. **Mercado Livre** (só se o usuário quiser encarar o cadastro):
   - Criar app em developers.mercadolivre.com.br/devcenter
   - Redirect URI idêntica à do `.env` (`https://localhost/callback`)
   - Escopos **`read`** e **`offline_access`** (sem o segundo não vem refresh token)
   - `ML_CLIENT_ID` + `ML_CLIENT_SECRET` no `.env`, depois `npm run ml:auth`
   - `npm run probe:ml` → **aqui se descobre se o search funciona autenticado**

5. **OLX** — decisão nunca tomada. Agora existe infraestrutura de navegador
   (`src/http/browser.js`) que provavelmente resolve o Cloudflare do mesmo jeito
   que resolveu o PerimeterX. É o caminho mais barato para a 2ª fonte.

6. **Só quando houver 2+ fontes:** dedupe cross-plataforma (a colisão de
   fingerprint da seção 2-A é real; exige 2ª evidência, tipo hash da 1ª foto).

7. **Sem testes automatizados ainda.** Os fixtures em `data/probe-*.json` são a
   base pronta; `scripts/ingest-fixture.js` já roda o pipeline sem rede.

---

## 5. Decisões de arquitetura (e por quê)

**O requisito principal é a instabilidade das fontes, não o volume de dados.**
Nenhuma das três oferece API pública de consulta, então tudo pode quebrar a
qualquer momento. O desenho inteiro existe para absorver isso.

- **Adapter é peça descartável.** Só busca e mapeia — nada de banco, filtro ou
  regra de negócio. Quando o Webmotors mudar o endpoint, reescreve-se
  `src/adapters/webmotors.js` (~120 linhas) e nada mais é afetado. O núcleo
  (normalize → fingerprint → pipeline → diff) não sabe de onde o dado veio.
- **Isolamento por par (watch, fonte)** em `pipeline.js`: OLX bloqueada não
  derruba ML e Webmotors. O erro vira uma linha em `fetch_runs` e um circuit
  breaker fecha aquela fonte pelo resto da rodada.
- **`fetch_runs` é a tabela de diagnóstico.** Primeiro lugar para olhar quando
  uma fonte para de trazer resultados.
- **A tabela `events` é o coração do painel.** O usuário não quer uma lista de
  carros; quer ver *o que mudou* desde ontem: novo, baixou preço, sumiu (vendeu —
  o sinal de preço de mercado mais honesto que existe), reanunciado.
- **FIPE muda o painel de nível.** Ordenar por `% FIPE` é o objetivo real; listar
  preço absoluto não serve para decidir nada. API gratuita da parallelum, com
  cache em disco porque exige 4 chamadas encadeadas por consulta.
- **Ser educado é decisão de projeto, não timidez.** 12s + jitter entre requests
  ao mesmo host, backoff exponencial, respeito a `Retry-After`, cookies
  persistidos entre rodadas. São 5–10 buscas específicas, não uma varredura —
  dá para ser praticamente invisível. Coleta de hora em hora basta: o mercado de
  carro usado não muda em cinco minutos.
- **Tokens do ML fora do `.env`.** O access token vale **6 horas**; fixo no
  `.env` a coleta pararia sozinha na mesma tarde e o usuário só descobriria dias
  depois vendo um painel vazio. Ficam em `data/ml-tokens.json` e
  `getAccessToken()` renova sozinho 10 min antes de expirar.

---

## 6. Descobertas sobre cada fonte (pesquisado em 2026-09-06)

| Fonte | Situação real |
|---|---|
| **Mercado Livre** | Único com API oficial documentada. `GET /sites/MLB/search?category=MLB1744` (MLB1744 = Carros e Caminhonetes). Exige `Bearer` token; **confirmado 403 sem token**. O ML vem restringindo esse endpoint mesmo para apps autenticados. Token: 6h; refresh: ~6 meses; `POST /oauth/token` com params no **body**, nunca na query. |
| **Webmotors** | Sem API pública nem documentação. A SPA consome `GET /api/search/car?url=...&actualPage=N&displayPerPage=24`. **Protegido por PerimeterX** — tolera pouco volume, sinaliza rajadas (ver 2-B). Contrato de campos verificado em 2026-09-06. |
| **OLX** | A API oficial (developers.olx.com.br) é para **publicar** anúncios (OAuth + plano profissional), **não serve** para monitorar. Sobra ler o HTML da busca e extrair `__NEXT_DATA__`. Anti-bot agressivo (DataDome). |

**Ponto que vale relembrar ao usuário se ele perguntar "por que não usa a API
oficial da OLX":** porque ela é de anunciante, não de consulta. Não existe rota
oficial para o que ele quer.

---

## 7. Pendências e riscos conhecidos

- **Fingerprint tem colisão comprovada** — ver seção 2-A. Não fundir anúncios
  com base nele. Irrelevante enquanto só uma fonte funciona.
- **Match da FIPE é heurístico** (só afeta fontes que não trazem FIPE pronta;
  o Webmotors traz) (sobreposição de palavras em `bestMatch`). A
  FIPE nomeia versões de forma muito verbosa; provavelmente vai errar em alguns
  casos. Precisa de conferência manual na primeira leva.
- ~~`year_fab` vs `year_model`~~ **conferido no Webmotors**: `YearFabrication`
  vem string ("2017") e `YearModel` número (2018); mapeamento correto.
- **Notificações Telegram:** código pronto, `NOTIFY_ENABLED=false`, nunca testado.
- ~~Filtros de URL do Webmotors não verificados~~ **RESOLVIDO (2026-09-07): não
  existem.** O Webmotors ignora a querystring. `buildSearchPath` não a monta mais
  e a paginação foi ampliada para cobrir a busca inteira. Ver seção 2-C.
- **URL do anúncio do Webmotors não verificada** — montada por padrão, não veio
  no payload. Confirmar clicando num link na primeira coleta.
- **Sem testes automatizados.** Consciente: o esqueleto veio primeiro. Os
  fixtures em `data/probe-*.json` são a base natural para testar `mapItem` sem
  bater na rede — e agora que o Webmotors tem PerimeterX, testar contra fixture
  em vez de contra a rede deixou de ser só elegância e virou necessidade.
- **Nada de git ainda.** O diretório não é um repositório. `.gitignore` já existe
  (protege `.env`, `data/cookies/`, `logs/`) — falta `git init`.
- **`fetch_runs.started_at` grava o fim da rodada, não o início** (achado da
  sessão 5). O `INSERT` em `src/db/repositories/watches.js:18` não passa a coluna
  e o `DEFAULT CURRENT_TIMESTAMP` roda no insert, que acontece no fim. Toda linha
  do tempo tirada dessa coluna está deslocada pelo `duration_ms`. Ver seção 2-F.
- **Os caminhos de recuperação de falha nunca rodaram** (laço de 3 tentativas,
  `waitUntil: 'commit'`, `porPagina` fixado). Estão no código desde a sessão 4,
  mas entraram depois da última coleta boa. Ver seção 2-F.
- **A coleta agendada já falhou por servidor desligado** — em 2026-09-08 a rodada
  das 9h não aconteceu e nada avisou. Considerar mostrar no painel a data da
  última rodada `OK`, para o dado velho não passar por dado fresco.

---

## 8. Mapa dos arquivos

```
src/
├── adapters/       um por fonte. DESCARTÁVEL: só busca e mapeia.
│   ├── base.js         contrato + helpers
│   ├── mercadolivre.js API oficial + token auto-renovado
│   ├── webmotors.js    2 transportes: navegador (padrão) ou http  [COLETANDO ✅]
│   └── olx.js          HTML + __NEXT_DATA__    [CONTRATO NÃO VERIFICADO]
├── auth/mercadolivre.js  OAuth + renovação automática do token de 6h
├── core/
│   ├── normalize.js    parsing de preço/km/ano/UF + matchesWatch
│   ├── fingerprint.js  dedupe entre plataformas
│   ├── progress.js     estado da coleta p/ a barra do painel   [NOVO 09-08]
│   └── pipeline.js     orquestra a rodada e gera os eventos
├── http/
│   ├── client.js       rate limit, backoff, Retry-After, 403 = anti-bot
│   ├── browser.js      COLETA VIA CHROMIUM — o que faz o Webmotors  [NOVO 09-08]
│   ├── rateLimiter.js  fila serial por host
│   └── cookieJar.js    sessão persistida em disco
├── db/pool.js + repositories/{listings,events,watches}.js
├── enrich/{fipe.js,run.js}
├── notify/{index.js,telegram.js}
├── server.js       API + estáticos + cron
└── cli.js          collect | fipe | notify
db/                 schema.sql (6 tabelas) + migrate.js + seed.js
public/             painel (index.html, app.js, style.css)
scripts/
├── ml-auth.js          fluxo OAuth interativo do ML
├── ingest-fixture.js   roda o pipeline com fixture, SEM rede   [NOVO 09-07]
└── probe/              validação das fontes  <- COMEÇAR AQUI
    └── probe-wm-browser.js  testa 1 página via navegador       [NOVO 09-07]
watches.yaml        o que monitorar
data/browser/       perfil do Chromium (cookies do PerimeterX). NÃO versionar,
                    NÃO apagar sem motivo: é o que evita CAPTCHA toda coleta.
```

---

## 9. Comandos

```bash
npm start                  # painel em http://localhost:3000 + agendador
npm run collect webmotors  # uma coleta agora (~5 min, abre janela do Chromium)
npm run collect olx        # a da OLX leva ~4s (uma pagina so)
npm run collect mercadolivre  # ~5s (uma pagina so, sem token)
npm run probe:ml:browser   # testa o site publico do ML, sem token  <- USE ESTE
npm run probe:ml:browser -- --robots         # robots.txt do ML
# no painel: um botao por portal, ao lado do "Coletar tudo"

npm run probe:wm:browser   # testa UMA página via navegador  <- USE ESTE
npm run probe:wm           # via fetch do Node — hoje SEMPRE dá 403 do PerimeterX
npm run probe:olx:browser  # testa a OLX via navegador  <- USE ESTE
npm run probe:olx:browser -- --robots        # so o robots.txt da OLX
npm run probe:olx          # via fetch do Node — bloqueado, esperado
npm run probe:ml           # testa Mercado Livre (precisa de token)

npm run ingest:fixture     # roda o pipeline com fixture, SEM tocar na rede
npm run db:migrate         # cria database + tabelas
npm run db:seed            # watches.yaml -> banco
npm run ml:auth            # autoriza o Mercado Livre (OAuth interativo)
```

**Antes de depurar mapeamento, use fixture, não a rede.** `probe:wm` com o
cliente HTTP comum vai dar 403 — isso é esperado desde 2026-09-07, não é
regressão.

Diagnóstico — **a fonte da verdade sobre uma coleta**, porque a tela engana:

```sql
SELECT source, status, items_found, duration_ms, error, started_at
  FROM fetch_runs ORDER BY started_at DESC LIMIT 20;
```

Conferir o que foi coletado:

```sql
SELECT COUNT(*) total, SUM(active=1) ativos FROM listings;
SELECT year_model, km, price, ROUND(fipe_ratio*100) fipe_pct, uf
  FROM listings WHERE active=1 ORDER BY fipe_ratio ASC LIMIT 10;
```

---

## 10. Preferências do usuário observadas

- Escreve em português; responder em português.
- **JavaScript, não Python** — foi explícito sobre isso.
- Prefere usar o que já tem instalado na máquina em vez de adicionar
  infraestrutura nova (foi assim que o MySQL entrou no lugar do SQLite).
- Pede explicação campo a campo quando não conhece um conceito (foi o caso das
  variáveis OAuth do ML) — vale explicar antes de mandar executar.
- **INSTRUÇÃO PERMANENTE (sessão 3):** *"sempre que você fizer algo novo escreva
  no nosso arquivo de histórico"*. Toda alteração relevante — código, decisão,
  descoberta, erro — deve ser registrada aqui no `ESTADO.md` antes de encerrar.
  Não é um pedido pontual: vale para todas as sessões.
- **Carro de interesse: Mitsubishi Lancer**, até 100 mil km, em todos os portais
  que estiverem funcionando.
