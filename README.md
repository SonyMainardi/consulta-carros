# Consulta de Carros

Monitor local de anúncios de carros no **Webmotors, OLX e Mercado Livre**, com
painel web. Roda inteiro na sua máquina — Node + MySQL, sem serviço externo e sem
conta em lugar nenhum.

Você escolhe **marca e modelo** em dois selects, diz km, ano, preço e em quais
portais procurar, e clica **Buscar**. Cada carro vem comparado com a tabela
**FIPE**, que é por onde você vai ordenar de verdade.

Não existe "busca salva": o que você escolheu vive **na URL**, e o link
reproduz a mesma busca em qualquer máquina. O que o banco guarda são os
**anúncios**, indexados por (marca, modelo) — um cache compartilhado, que
responde na hora quando alguém já pediu aquele carro há pouco.

Marcando **☆ Acompanhar**, o carro passa a ser recoletado e aí sim aparece
**o que mudou**: apareceu, baixou de preço, saiu do ar.

**Nada roda sozinho**: não há agendador. Toda coleta sai de um clique.

---

# Como rodar

## Antes de começar

| Precisa | Versão | Como conferir |
|---|---|---|
| **Node.js** | 20 ou mais novo | `node -v` |
| **MySQL** | 8 | `mysql --version` — e o serviço precisa estar rodando |
| **Chromium** do Playwright | — | instalado no passo 1 |

> A coleta abre um **navegador de verdade** na sua tela. Não é opcional: as três
> fontes barram requisição de script. Veja [Por que um navegador](#por-que-um-navegador-de-verdade).

## 1. Instalar

```bash
git clone https://github.com/SonyMainardi/consulta-carros.git
cd consulta-carros
npm install
npx playwright install chromium     # o navegador que faz a coleta
```

## 2. Configurar

```bash
cp .env.example .env
```

Abra o `.env` e preencha **uma coisa só**: `DB_PASSWORD`, a senha do seu MySQL.
Todo o resto já vem com valor bom.

## 3. Criar o banco

```bash
npm run db:migrate     # cria o database e as tabelas
npm run db:catalogo    # semeia o catalogo da FIPE: ~107 marcas e ~1.200 modelos
```

## 4. Subir o painel

```bash
npm start
```

Abra **http://localhost:3000**. O painel já sobe funcionando — vazio, porque
ainda não houve coleta.

## 5. A primeira busca

No painel, escolha **marca** e **modelo** nos dois selects, preencha o que quiser
de **km máximo, ano e preço máximo**, marque os **portais** e clique **Buscar**.

O que vai acontecer:

- Se alguém já pediu esse carro nas últimas 6 horas, a resposta vem **na hora**,
  do cache. A frase acima da tabela diz de quando é.
- Se não, a busca **responde mesmo assim** com o que houver e a coleta vai por
  fora: **uma janela do Chromium abre** (não feche: é ela que coleta) e o botão
  do portal vira barra de progresso.
- **OLX e Mercado Livre levam segundos** (uma página cada). O **Webmotors leva
  ~3 minutos**: são 5 páginas, com 30-40s de intervalo entre elas, de propósito.
  Os três portais rodam **ao mesmo tempo**.
- Se aparecer um **CAPTCHA**, o botão fica laranja escrito *"Resolva o CAPTCHA na
  janela"*. Resolva na janela do Chromium e a coleta continua sozinha. Você tem
  5 minutos.

O botão **Atualizar** força a coleta do carro que está na tela, mesmo com o cache
fresco. Os botões de portal ao lado fazem o mesmo, só naquele portal.

**A busca fica na URL:** `?modelo=901&km=100000&anoMin=2012&versao=GT`. Dá para
guardar nos favoritos e mandar para alguém.

Pelo terminal, se preferir:

```bash
npm run collect mitsubishi/lancer       # um carro, todos os portais
npm run collect mitsubishi/lancer olx   # só um portal
npm run collect --acompanhados          # todos os carros marcados com ☆
```

## 6. Confira se deu certo — a tela engana

A janela do Chromium fechar e o painel mostrar carros **não** significa que a
coleta funcionou: pode ser o resultado da rodada anterior. A fonte da verdade é a
tabela `fetch_runs`:

```sql
SELECT source, status, items_found, duration_ms, error, started_at
  FROM fetch_runs ORDER BY started_at DESC LIMIT 5;
```

`status = OK` com `items_found > 0` é sucesso. Qualquer outra coisa, a coluna
`error` diz o que houve.

---

# O que o painel mostra

- **A barra de busca**: marca, modelo e os limites. Tudo o que vem abaixo é do
  que foi pedido ali, e uma frase diz **de quando** é o que está na tela
- **Cartões**: ativos, novos em 24h, baixas de preço e saídas dos últimos 7 dias
- **O que mudou**: o log de eventos — novo, baixou, subiu, saiu do ar, reanunciado, km mudou
- **Anúncios ativos**: a tabela, com
  - filtros de **faixa de km** e **câmbio** (chips)
  - filtro por **estado** e por **portal** — clique nas palavras `LOCAL` e `FONTE` no cabeçalho
  - **ordenação por clique** em `ANO`, `KM`, `PREÇO` e `FIPE`: um clique crescente, outro inverte
  - **% da FIPE** por anúncio: verde abaixo da tabela, vermelho acima
  - um **coração** no começo de cada linha, que guarda o anúncio nos favoritos
- **Favoritos**: o botão no canto de cima abre a lista dos anúncios guardados —
  de qualquer carro, não só o da busca

### Favoritos

Clique no coração de um anúncio para guardá-lo; clique de novo para tirar. O
painel **Favoritos** mostra, de cada um:

- se ele **segue no ar**, **baixou** ou **subiu** de preço desde que você o
  guardou (`R$ 52.000 → R$ 48.000`), **saiu do ar** ou **não foi visto** na
  última coleta;
- **de quando** é essa informação ("visto há 2h"). O painel não coleta nada:
  para atualizar um favorito, busque o carro dele — o nome do carro na linha é
  um link para essa busca.

Os favoritos ficam no banco (tabela `favoritos`), não no navegador: sobrevivem a
limpar o histórico e aparecem em qualquer navegador que abrir o painel. Não
confunda com o **☆ Acompanhar**, que marca um *carro* inteiro para ter
histórico de eventos; o coração marca um *anúncio*.

### "Saiu do ar" só quando é verdade

OLX e Mercado Livre deixam ler **uma página** da busca (paginar é proibido no
robots.txt dos dois), e o Webmotors para em 5 páginas. Quando a coleta
**não** viu a busca inteira, um anúncio que não apareceu pode só ter caído para a
página 2 — então ele sai da tela **sem** virar "saiu do ar". O evento só aparece
quando a coleta leu a busca inteira. A janela de buscas mostra, por portal, se a
última coleta foi "busca inteira" ou "1ª página de N anúncios".

E se o endereço de um portal estiver errado (a página que voltou não é daquele
carro), a coleta daquele portal **falha** em vez de gravar carro errado — o
endereço se corrige em Editar > "Endereço em cada portal".

---

# As três fontes

| Fonte | Como é lida | Situação |
|---|---|---|
| **Webmotors** | O navegador abre a busca e nós **interceptamos a chamada que a própria SPA faz** a `/api/search/car` | ✅ funcionando. Traz o `% da FIPE` pronto, o que dispensa consultar a API da FIPE |
| **OLX** | HTML da busca; os anúncios vêm no stream **RSC** do Next.js (`self.__next_f.push`) | ✅ funcionando. Uma página por coleta |
| **Mercado Livre** | HTML da busca, renderizado no servidor (`<li class="ui-search-layout__item">`) | ✅ funcionando, **sem token e sem app cadastrado** |

O Mercado Livre **também** tem API oficial, que exige app registrado e OAuth. Ela
não é usada pela coleta — mas o código continua no projeto, veja
[Mercado Livre pela API oficial](#mercado-livre-pela-api-oficial-opcional).

## Por que um navegador de verdade

Não é volume: essas proteções avaliam o **fingerprint de TLS** da conexão. Um
`fetch` do Node é barrado na primeira requisição, com qualquer intervalo — subir
de 12s para 60s não muda nada. Um Chromium real passa.

Duas consequências que valem entender antes de mexer no código:

1. **Nada de CAPTCHA é contornado.** Não há solver, nem proxy, nem disfarce de
   fingerprint. Quando aparece um desafio, a janela fica aberta e **quem resolve
   é você**. É por isso que `BROWSER_HEADLESS=false` — headless é detectado, e
   sem janela ninguém resolveria nada.
2. **Nenhum filtro vai na URL de busca.** Os `robots.txt` das três fontes proíbem
   os parâmetros de filtro (na OLX e no ML, até a paginação). A busca vem
   inteira, pelo caminho de marca/modelo, e o recorte de km, preço e ano acontece
   **depois** da coleta, em `matchesWatch`. Se você acrescentar querystring, o
   projeto passa a desrespeitar a regra escrita da fonte.

---

# Como o catálogo funciona

Marca e modelo não se digitam: saem de um **catálogo fixo** no banco, semeado da
tabela FIPE por `npm run db:catalogo` — ~107 marcas e ~1.200 modelos.

Cada par (modelo, portal) tem um **endereço** próprio, porque os portais não
escrevem igual: na OLX, Volkswagen é `vw-volkswagen` e Chevrolet é
`gm-chevrolet`. Esses endereços **se corrigem sozinhos**: a coleta confere se a
página é mesmo do carro pedido e marca o endereço como `CONFIRMADO` ou
`QUEBRADO`. Consertar um endereço quebrado é editar **uma linha**, e o conserto
vale para todo mundo que pedir aquele carro.

Km, preço, ano e versão **não vão na URL dos portais** (o robots.txt proíbe)
**nem na coleta**: a busca vem inteira, o cache guarda tudo, e o recorte acontece
na leitura. Marca e modelo são conferidos por **palavra inteira** ("Gol" não pega
"Golf"), e a versão também ("GT" não pega "GTI").

**Versão fica no campo de versão, nunca no modelo.** Os portais não têm endereço
para versão: por isso o catálogo só tem modelos, e "Vectra GT" se pede como
modelo **Vectra** + versão **GT**.

## Acompanhar um carro

Uma busca ao vivo acontece uma vez, e nada muda entre uma vez só — então
"novo", "baixou de preço" e "saiu do ar" não existiriam. Clicando em
**☆ Acompanhar**, o carro passa a ser recoletado e o histórico começa a valer.
O histórico de preço é gravado sempre, acompanhado ou não.

---

# Comandos

```bash
npm start                     # painel (sem agendador: coleta só por clique)
npm run dev                   # idem, com reload

npm run collect mitsubishi/lancer        # um carro, todos os portais
npm run collect mitsubishi/lancer olx    # só um portal
npm run collect --acompanhados           # os carros marcados com ☆

npm run db:migrate            # cria database e tabelas
npm run db:catalogo           # semeia marcas e modelos da FIPE
npm run db:catalogo -- --marca=Honda     # só uma marca (útil para teste)

node src/cli.js fipe 100      # preenche a FIPE dos pendentes
node src/cli.js notify        # envia notificações pendentes
```

### Depurando uma fonte

```bash
npm run probe:wm:browser      # Webmotors, uma página, via navegador
npm run probe:olx:browser     # OLX
npm run probe:ml:browser      # Mercado Livre
npm run probe:olx:browser -- --robots    # o que o robots.txt da fonte proíbe
```

Cada probe faz **uma** requisição (o modo `--robots` faz uma por host), diz se a
fonte respondeu, quantos anúncios saíram e salva a página crua em `data/` para
você comparar com o mapeamento do adapter.

> `npm run probe:wm` e `npm run probe:olx` (sem `:browser`) usam o `fetch` do
> Node e **vão dar bloqueio**. Isso é esperado, não é regressão.

---

# Estrutura

```
src/
├── adapters/     um por fonte. DESCARTÁVEL: só busca e mapeia.
├── core/         normalize (parsing + recorte), pipeline (orquestra), marcas
│                 (apelidos e slug por portal), orcamento (páginas por busca), progress
├── http/         client (rate limit, backoff, cookies) + browser (Playwright)
├── db/           pool + repositories + limites (km/preço/ano da busca em SQL)
├── enrich/       FIPE (enriquecimento e catálogo de marcas/modelos)
├── notify/       Telegram
├── server.js     API + estáticos
└── cli.js
db/               schema.sql + migrate + seed
public/           painel (HTML/CSS/JS, sem framework)
scripts/probe/    validação das fontes
```

**O requisito principal deste projeto é a instabilidade das fontes**, não o
volume de dados. Nenhuma das três oferece API pública de consulta, então tudo
pode quebrar a qualquer momento. Por isso **adapter é peça descartável**: só
busca e mapeia, sem banco, filtro ou regra de negócio. Quando um portal mudar o
contrato, você reescreve um arquivo de ~150 linhas e nada mais é afetado.

---

# Ser educado com as fontes

Os padrões do `.env` são deliberadamente lentos, e isso é decisão de projeto, não
descuido:

- **60 a 80 segundos** entre requisições ao mesmo host (30-40 no Webmotors, que
  é o único que pagina — intervalo + jitter)
- backoff exponencial, respeito a `Retry-After`, circuit breaker por fonte
- sessão do navegador persistida entre coletas (reduz muito a chance de desafio)
- **no máximo 5 páginas do Webmotors por busca**, e coleta só quando você clica
  — o mercado de carro usado não muda em cinco minutos

Nunca use `fetch` direto contra as fontes, nem em script descartável: sempre
`src/http/client.js` ou `src/http/browser.js`, que passam pelo mesmo limitador.
Um script com `fetch` cru fez ~10 requisições em segundos e derrubou o acesso ao
Webmotors por **21 horas**.

Vale registrar: os termos de uso dessas plataformas restringem coleta
automatizada, e os anúncios contêm dado pessoal de vendedor pessoa física, o que
atrai LGPD. Uso pessoal, volume baixo, sem redistribuir os dados e sem guardar
contato que você não vá usar é uma posição confortável. Coletar telefone em
massa, não.

---

# Diagnóstico

`fetch_runs` registra toda execução por fonte — status, itens, erro e duração. É
o primeiro lugar para olhar quando uma fonte para de trazer resultados:

```sql
SELECT source, status, items_found, duration_ms, error, started_at
  FROM fetch_runs ORDER BY started_at DESC LIMIT 20;
```

O que foi coletado:

```sql
SELECT COUNT(*) total, SUM(active = 1) ativos FROM listings;

SELECT year_model, km, price, ROUND(fipe_ratio * 100) fipe_pct, uf
  FROM listings WHERE active = 1 ORDER BY fipe_ratio LIMIT 10;
```

Em caso de bloqueio, `err.guard` diz **qual** proteção respondeu (PerimeterX,
Cloudflare, DataDome). Não insista: cada tentativa renova o bloqueio.

---

# Mercado Livre pela API oficial (opcional)

A coleta **não precisa disto**. Está aqui porque a API traz campos que o card do
site não tem (câmbio, cor e combustível estruturados), caso um dia você queira.

O access token do ML vale **6 horas**, então ele não fica no `.env`: vive em
`data/ml-tokens.json` e se renova sozinho pelo `refresh_token`.

1. Crie um app em [developers.mercadolivre.com.br/devcenter](https://developers.mercadolivre.com.br/devcenter)
2. Cadastre a redirect URI **idêntica** à do `.env` (padrão `https://localhost/callback`)
3. Marque os escopos **`read`** e **`offline_access`** — sem o segundo não vem `refresh_token`
4. Preencha `ML_CLIENT_ID` e `ML_CLIENT_SECRET` no `.env`
5. `npm run ml:auth` — autorize no navegador e cole de volta a URL do redirect
6. `npm run probe:ml` — **é aqui que se descobre** se o search funciona para o seu app

A página do redirect vai dar erro de conexão; é normal, o que importa é o
parâmetro `code=` na barra de endereços.

> Sem token, `/sites/MLB/search` devolve 403 — confirmado. Com token é incógnita:
> o ML vem restringindo o endpoint para apps que não são de vendedor.

---

# Documentação interna

- **`ESTADO.md`** — o histórico completo do projeto: o que foi verificado de
  verdade, o que só foi escrito e nunca testado, e cada erro que custou caro,
  com o porquê. É o primeiro arquivo a ler antes de mexer em qualquer coisa.
