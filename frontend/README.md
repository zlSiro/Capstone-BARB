# BARB Frontend (Angular 22)

## Requisitos
- Node.js 22.22.3+
- Backend corriendo en `http://localhost:9000`

## Instalación
```bash
npm install




cat > README.md << 'EOF'
# BARB Frontend (Angular 22)

## Requisitos
- Node.js 22.22.3+
- Backend corriendo en http://localhost:9000

## Instalación
npm install

## Desarrollo
npm start
# Corre en http://localhost:4200 y hace proxy de /api → http://localhost:9000

## Estructura
- core/ — Servicios, guards, interceptores, modelos
- shared/ — Componentes reutilizables, layout, UI
- features/ — Pantallas por dominio (auth, dashboard, work-orders...)

## Credenciales demo
- admin@barb.com / admin123

## Build producción
npm run build
