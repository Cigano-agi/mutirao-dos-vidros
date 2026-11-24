# Mutirão dos Vidros

Protótipo de aplicativo para coordenar pedidos de troca de vidros em mutirões. O fluxo passa pelo cadastro do pedido, pela medição, pelo corte e pela instalação. Uma equipe de coordenação acompanha as etapas. A interface foi pensada para celulares e permite guardar alguns envios sem conexão.

**Estado do projeto:** demonstração e desenvolvimento local com dados fictícios. Use a demo para experimentar o fluxo. O protótipo ainda precisa de revisão de segurança e privacidade antes de receber cadastros reais, fotos ou endereços de moradores.

## Rodar a demonstração

Instale o Node.js 22.13 ou mais recente. A demo e os testes da API usam o SQLite do Node.js e dispensam a instalação de dependências.

```sh
npm run demo
```

Abra [http://localhost:8787](http://localhost:8787) e use um dos códigos de demonstração exibidos no terminal. Comece pelo papel de coordenação para ver o painel com pedidos de exemplo. A demo recria o arquivo local `demo.db` a cada execução. Acesse pelo próprio computador.

## Rodar os testes

```sh
npm test
```

O teste de interface usa Playwright. Para executá-lo, instale o Playwright globalmente e prepare o Chromium:

```sh
npm install --global playwright
npx playwright install chromium
npm run test:ui
```

Também é possível apontar `CHROMIUM` para um navegador Chromium compatível já instalado. O teste grava capturas em `capturas` no diretório pai do repositório.

## Contribuir

Leia [CONTRIBUTING.md](CONTRIBUTING.md) para reproduzir problemas e enviar mudanças. [CONFIGURACAO.md](CONFIGURACAO.md) descreve os componentes e as limitações para um piloto.

O código do projeto usa a licença [MIT](LICENSE). O Leaflet incluído em `public/vendor` mantém sua [licença BSD-2-Clause](public/vendor/LICENSE). Os tiles do mapa usam atribuição ao OpenStreetMap.
