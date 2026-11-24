# Componentes e limites do protótipo

- `public/` contém a aplicação web e o service worker.
- `api.mjs` implementa as etapas do mutirão e as permissões por papel.
- `server.mjs` e `schema.sql` usam SQLite no ambiente local.
- `worker.mjs` e `wrangler.example.toml` são referências para uma adaptação futura a Cloudflare Workers e D1. A configuração de exemplo usa valores genéricos.

A demonstração usa códigos públicos e dados fictícios. Para desenvolvimento local fora da demo, o servidor lê os códigos de acesso da variável de ambiente `CODIGOS`. `npm run codigos` gera valores novos. Guarde essa saída fora do repositório.

Antes de um piloto com moradores, revise como conceder e revogar acessos individuais, quais papéis precisam ver endereços, como proteger os dados em celulares compartilhados e quando eliminar registros, fotos e backups. Parte dos rascunhos e dos envios pendentes fica no navegador. O protótipo usa tiles públicos do OpenStreetMap e abre links de rota e contato em serviços externos quando a pessoa solicita. A confirmação de que uma tarefa foi assumida exige conexão.
