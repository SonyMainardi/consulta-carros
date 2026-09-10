# Consulta de Carros

Monitor local de anúncios de carros no **Webmotors, OLX e Mercado Livre**, com
painel web. Roda inteiro na sua máquina — Node + MySQL, sem serviço externo e sem
conta em lugar nenhum.

Ele coleta uma vez por dia, guarda o histórico de cada anúncio e te mostra **o
que mudou**: apareceu, baixou de preço, saiu do ar. Cada carro vem comparado com
a tabela **FIPE**, que é por onde você vai ordenar de verdade.

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
npm run db:seed        # carrega o watches.yaml para o banco
```

## 4. Subir o painel

```bash
npm start
```

Abra **http://localhost:3000**. O painel já sobe funcionando — vazio, porque
ainda não houve coleta.

> O agendador (`COLLECT_CRON`, padrão 9h da manhã) **só dispara com o
> `npm start` rodando**. Se a máquina estiver desligada às 9h, a coleta do dia
> não acontece.

## 5. A primeira coleta

No painel, clique em **Coletar tudo** — ou, para testar uma fonte só, no botão
daquele portal (Webmotors, OLX, Mercado Livre).

O que vai acontecer:

- **Uma janela do Chromium abre.** Não feche: é ela que faz a coleta.
- O botão vira barra de progresso.
- **Webmotors leva ~5 minutos** — 5 páginas, com 60-80s de intervalo entre elas,
  de propósito. **OLX e Mercado Livre levam ~4 segundos** cada, porque trazem
  uma página só.
- Se aparecer um **CAPTCHA**, o botão fica laranja escrito *"Resolva o CAPTCHA na
  janela"*. Resolva na janela do Chromium e a coleta continua sozinha. Você tem
  5 minutos.

Pelo terminal, se preferir:

```bash
npm run collect                # todas as fontes
npm run collect olx            # só uma
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

- **Cartões** no topo: ativos, novos em 24h, baixas de preço e saídas dos últimos 7 dias
- **O que mudou**: o log de eventos — novo, baixou, subiu, saiu do ar, reanunciado, km mudou
- **Anúncios ativos**: a tabela, com
  - filtros de **faixa de km** e **câmbio** (chips)
  - filtro por **estado** e por **portal** — clique nas palavras `LOCAL` e `FONTE` no cabeçalho
  - **ordenação por clique** em `ANO`, `KM`, `PREÇO` e `FIPE`: um clique crescente, outro inverte
  - **% da FIPE** por anúncio: verde abaixo da tabela, vermelho acima

### Teto de exibição

Por padrão o painel **não mostra** carro acima de R$ 100.000 nem acima de 100.000
km. É recorte de tela, não de coleta: o anúncio continua sendo guardado com todo
o histórico. Para mudar, no `.env`:

```bash
PANEL_PRICE_MAX=100000    # 0 desliga
PANEL_KM_MAX=100000
```

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

# Configurando o que monitorar

Edite `watches.yaml` e rode `npm run db:seed`:

```yaml
watches:
  - slug: mitsubishi-lancer
    name: "Mitsubishi Lancer ate 100 mil km"
    enabled: true
    brand: Mitsubishi
    model: Lancer
    km_max: 100000
    sources: [webmotors, olx, mercadolivre]
```

Campos aceitos: `brand`, `model`, `version_contains`, `year_min`, `year_max`,
`price_min`, `price_max`, `km_max`, `uf` (`"SP"` ou `"SP,MG"`), `sources`.

Todos são aplicados **depois** da coleta (`core/normalize.matchesWatch`), nunca
na URL — veja o motivo acima.

---

# Comandos

```bash
npm start                     # painel + agendador
npm run dev                   # idem, com reload

npm run collect               # uma coleta agora, todas as fontes
npm run collect webmotors     # só uma fonte

npm run db:migrate            # cria database e tabelas
npm run db:seed               # watches.yaml -> banco

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
├── core/         normalize (parsing), pipeline (orquestra), panelLimits, progress
├── http/         client (rate limit, backoff, cookies) + browser (Playwright)
├── db/           pool + repositories
├── enrich/       FIPE
├── notify/       Telegram
├── server.js     API + estáticos + cron
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

- **60 a 80 segundos** entre requisições ao mesmo host (intervalo + jitter)
- backoff exponencial, respeito a `Retry-After`, circuit breaker por fonte
- sessão do navegador persistida entre coletas (reduz muito a chance de desafio)
- **uma coleta por dia** — o mercado de carro usado não muda em cinco minutos

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
