# CLAUDE.md — JARVIS

Proyecto independiente dentro de `jarvis/` (no forma parte de OpenShorts).

- Antes de commitear: `npm run check` (typecheck + lint 0 avisos + tests).
- Lee ARCHITECTURE.md, SECURITY.md y DECISIONS.md antes de cambios estructurales.
- Toda acción con efectos debe implementarse como herramienta del `ToolRegistry` con riesgo y permisos honestos.
- No marques nada como terminado sin probarlo; actualiza PROGRESS.md, TESTING.md y CHANGELOG.md.
- Paleta visual: naranja + azul oscuro (ADR-010).
- No generar gastos ni activar servicios de pago sin aprobación explícita del usuario.
