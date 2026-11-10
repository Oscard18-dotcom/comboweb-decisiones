# ComboWeb Decisiones · EN COMBO — ComboWeb App + pestaña "Toma de decisiones"

Sprint 2: **base de datos PostgreSQL**, **autenticación por roles** y **catálogo**.
Sprint 3: **armado del combo, validación de insumos y horario, pago y comprobante** (HU01 a HU05 del lado del cliente).
Sprint 4: **inventario con movimientos y alertas de reorden, recetas con costeo** y las pantallas del personal (HU07 a HU10).
Sprint 5: **tablero de cocina, notificaciones por correo, seguimiento del pedido, dashboard y reportes** (HU05, HU06, HU11).
Sprint 6: **seguridad de cuentas, pantallas de usuarios y catálogo, revisión de seguridad, despliegue, manual de usuario y documentación técnica**.

## Instalación fácil en Windows (para personas sin experiencia)
Lee la **Guía de instalación y primeros pasos** (`docs/Guia_de_instalacion_y_primeros_pasos.pdf`, en letra grande). En resumen:
1. Instalar **Node.js** (versión LTS, 22 o superior) y **PostgreSQL 16** (contraseña sugerida: `AdminEnCombo2026`). No hace falta Visual Studio ni ningún programa para programar.
2. Extraer el ZIP en `C:\EnCombo`.
3. Doble clic en **`instalar.bat`**: crea la base de datos, la configuración, las tablas y las cuentas de práctica.
4. Doble clic en **`iniciar.bat`** cada día (abre el navegador en http://localhost:3000; guarda una copia de seguridad en `respaldos/`; para apagar, cerrar la ventana negra).

Cuentas de práctica (contraseña inicial `EnCombo-2026`, cámbiala en *Mi cuenta*): `admin@encombo.test`, `cocina@encombo.test`, `almacen@encombo.test` y `cliente@encombo.test`.
Modo práctica: el pago es simulado y los correos solo se muestran en la ventana negra. Para operar con clientes reales, ver *Documentación técnica*, secciones 10 y 11.

## Requisitos
- Node.js 18 o superior
- PostgreSQL 14 o superior

## Puesta en marcha
1. Crea la base de datos y un usuario propio (en `psql`):
   ```sql
   CREATE USER combo_user WITH PASSWORD 'una_clave_segura';
   CREATE DATABASE comboweb OWNER combo_user;
   ```
2. Instala dependencias: `npm install`
3. Copia `.env.example` como `.env` y llena `DATABASE_URL`, `JWT_SECRET` (mínimo 32 caracteres aleatorios) y `SEED_PASSWORD`.
4. Crea las tablas: `npm run db:init`
5. Carga datos iniciales (insumos, productos con receta, presentaciones y 3 usuarios de prueba): `npm run db:seed`
6. Arranca: `npm start` (o `npm run dev`) y abre http://localhost:3000

Usuarios de prueba (contraseña = tu `SEED_PASSWORD`): `admin@encombo.test`, `cocina@encombo.test`, `almacen@encombo.test`.
**Cámbialos o desactívalos antes de publicar el sistema.**


## Sprint 3: cómo funciona la compra
1. El cliente arma su combo (productos, presentación, dedicatoria opcional, fecha y hora). Cada cambio se **cotiza y valida en el servidor** (`POST /api/pedidos/cotizar`): precios siempre de la base de datos, insumos suficientes (ext. 8.a) y horario libre (ext. 10.a, máximo 2 pedidos por horario, con horarios alternativos).
2. **Pagar** crea un *checkout* (el combo queda guardado) y lleva al cliente a la pasarela. **Todavía no existe el pedido.**
3. Cuando la pasarela confirma el cobro, el sistema, en **una sola transacción**: vuelve a validar insumos y horario, crea el pedido con estatus *Pendiente*, descuenta el inventario (con movimientos de salida), registra el pago y genera el comprobante. Si algo falla, no queda nada a medias.
4. El cliente vuelve al sitio, ve su **comprobante** (se puede imprimir) y sigue su pedido en **Mis pedidos**.

Casos que cuida el sistema: pago repetido o webhook reenviado (no duplica nada), dos clientes pagando el último insumo o el último horario al mismo tiempo (solo uno se queda), monto o moneda distintos al cobrado, y firma falsa en el webhook. Un pago que ya se cobró pero no se pudo reservar queda en estado **`revision`** (aparece en el log del servidor): hay que **reembolsarlo manualmente** desde el panel de la pasarela.

### Pago simulado (desarrollo)
Con `PAYMENT_PROVIDER=simulado` (valor por defecto) la compra lleva a una pantalla local con los botones "Pagar (simulado)" y "Rechazar". No cobra nada. **El servidor se niega a arrancar en producción con este modo.**

### Pago real con Stripe (modo de prueba)
1. Crea una cuenta en stripe.com y copia tu llave secreta **de prueba** (`sk_test_...`).
2. Instala la Stripe CLI y ejecuta: `stripe listen --forward-to localhost:3000/api/pagos/webhook/stripe`. Te mostrará un secreto `whsec_...`.
3. En `.env`: `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`. Reinicia el servidor.
4. Paga con la tarjeta de prueba `4242 4242 4242 4242` (cualquier fecha futura y CVC).
5. En producción: registra en el panel de Stripe un endpoint `https://TU-DOMINIO/api/pagos/webhook/stripe` con los eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded` y `checkout.session.expired`, y arranca con `NODE_ENV=production`.

## Nuevas rutas (Sprint 3)
| Método y ruta | Acceso | Descripción |
|---|---|---|
| GET `/api/pedidos/disponibilidad?fecha=AAAA-MM-DD` | Público | Horarios libres y ocupados |
| POST `/api/pedidos/cotizar` | Público | Valida el combo y calcula el total (no guarda nada) |
| POST `/api/pedidos/checkout` | Cliente | Valida, guarda el combo y devuelve el enlace de pago |
| GET `/api/pedidos/checkout/:id` | Cliente | Estado del pago |
| GET `/api/pedidos` | Cliente | Mis pedidos |
| GET `/api/pedidos/:id` | Dueño, cocina o admin | Detalle y comprobante |
| POST `/api/pagos/webhook/stripe` | Stripe (firma) | Confirmación de pago |
| POST `/api/pagos/simulado/:id/aprobar` o `/rechazar` | Cliente (solo desarrollo) | Pasarela simulada |

## Sprint 4: inventario y recetas

**Quién ve qué:** el *encargado de almacén* y el *administrador* ven el inventario; solo el *administrador* ve recetas, costos y márgenes. Cocina verá su tablero en el Sprint 5.

### Inventario (HU07, HU08, HU09)
- **El stock solo cambia con movimientos**: *entrada* (compra), *salida* (merma o consumo) y *ajuste* (conteo físico: se escribe el stock real). Todo queda en el **historial** con fecha, quién lo hizo y nota; los descuentos por pedido aparecen ligados al pedido.
- Una salida nunca deja el stock en negativo, ni siquiera con movimientos simultáneos.
- **Alertas de reorden:** hay alerta cuando el stock es **igual o menor al mínimo**. Se calcula al momento, así que desaparece sola al reponer. Se muestra el stock, el mínimo y cuánto reponer (sugerido: hasta el doble del mínimo).
- **Eliminar:** si el insumo está en una receta o presentación, el sistema **avisa en cuáles** y no lo permite; si ya tiene historial se **archiva** (no se pierde el historial); si es nuevo y sin movimientos se borra. Los archivados se ven con "Ver archivados" y se pueden reactivar.
- El descuento automático al confirmarse un pedido (HU08) ya funcionaba desde el Sprint 3.

### Recetas y costeo (HU10)
- Cada receta tiene **ingredientes con cantidades** y un **rinde** (cuántas piezas salen). **Las cantidades son para todo el lote**: al vender se descuenta *cantidad ÷ rinde* por pieza. Ejemplo: receta de 12 cupcakes con 480 g de harina → 40 g por cupcake.
- Si la división no es exacta (100 g ÷ 7 = 14.2857… g) el consumo se **redondea hacia arriba a 4 decimales**, para nunca prometer más de lo que hay.
- El costo se calcula con el **costo unitario vigente de cada insumo**: si cambia el precio de la mantequilla, el costo de las recetas cambia solo. La pantalla muestra costo del lote, costo por pieza y **margen**, en vivo mientras se edita.
- Un producto nuevo nace **inactivo** y solo se puede activar cuando tiene receta. No se puede borrar la receta de un producto activo.
- Una edición con error (por ejemplo un ingrediente inexistente) **no cambia nada**: la receta anterior queda intacta.

### Rutas nuevas (Sprint 4)
| Método y ruta | Acceso | Descripción |
|---|---|---|
| GET `/api/inventario` (`?inactivos=1`) | Almacén, admin | Lista de insumos con estado de reorden |
| GET `/api/inventario/alertas` | Almacén, admin | Insumos en nivel de reorden |
| POST `/api/inventario` | Almacén, admin | Crear insumo (la existencia inicial queda como entrada) |
| PUT `/api/inventario/:id` | Almacén, admin | Editar nombre, unidad, mínimo, costo, activo (**no** el stock) |
| POST `/api/inventario/:id/movimientos` | Almacén, admin | Entrada, salida o ajuste |
| GET `/api/inventario/:id/movimientos` | Almacén, admin | Historial (últimos 100) |
| DELETE `/api/inventario/:id` | Almacén, admin | Eliminar o archivar |
| GET `/api/recetas`, GET `/api/recetas/:id` | Admin | Recetas con ingredientes, costo y margen |
| POST `/api/recetas` | Admin | Crear receta de un producto |
| PUT `/api/recetas/:id` | Admin | Reemplazar rinde e ingredientes |
| DELETE `/api/recetas/:id` | Admin | Borrar (solo si el producto está inactivo) |

## Sprint 5: cocina, avisos al cliente y reportes

### Tablero de cocina (HU06) — operador de cocina y administrador
- Muestra los pedidos **de un día** (por defecto hoy) en cuatro columnas por estatus, en orden de hora, con dedicatoria destacada. Los pedidos de días anteriores que siguen sin entregarse salen marcados como **atrasados**.
- **Ficha técnica** de cada pedido: cliente, entrega, presentación, combo, dedicatoria e **ingredientes que consume** (según las recetas vigentes). La cocina no ve precios.
- El estatus solo avanza **hacia adelante y de uno en uno**: Pendiente → En preparación → Listo para entrega → Entregado. Un doble clic, o dos personas pulsando a la vez, **no duplican** el cambio ni el aviso. Si la pantalla estaba desactualizada, avisa con claridad y se pone al día.
- Cada cambio queda en el **historial** con fecha, hora y quién lo hizo. El tablero se actualiza solo cada 20 segundos.

### Avisos por correo al cliente (HU05)
- El cliente recibe un correo al **confirmarse** su pedido y en **cada cambio de estatus**.
- Los avisos se guardan en una **bandeja de salida** dentro de la misma transacción del cambio: nunca se pierde uno ni sale dos veces. Si el correo falla, **el pedido y el cambio de estatus no se afectan**; el aviso se reintenta a los 1, 4, 9 y 16 minutos y, tras 5 intentos, queda *fallida* (el administrador la ve en el Dashboard y puede **reintentarla**). Los envíos atascados se rescatan solos.
- El servidor (`npm start`) revisa la bandeja **cada minuto**, así que debe estar encendido. Con varios procesos a la vez cada correo sale una sola vez.
- **Configura el correo en `.env`** (hay 3 modos):
  - `MAIL_PROVIDER=consola` (por defecto): solo imprime en pantalla. **No se permite en producción.**
  - `MAIL_PROVIDER=smtp`: define `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM`. Sirve con Gmail (contraseña de aplicación), Brevo, Mailgun, etc.
  - `MAIL_PROVIDER=brevo`: define `BREVO_API_KEY` y `MAIL_FROM` (un remitente verificado en Brevo). Va por HTTPS, así que funciona en Render gratis; el plan gratis de Brevo tiene un tope diario de envíos.
  - `MAIL_PROVIDER=resend`: define `RESEND_API_KEY` y `MAIL_FROM`. Va por HTTPS; úsalo si tu hosting bloquea el puerto SMTP (algunos hostings gratuitos lo hacen).
- Los textos escapan lo que escribió el cliente (no se inyecta código en el correo) y el asunto solo lleva el folio.
- No incluye WhatsApp: solo correo, como indica el documento de tecnologías.

### Seguimiento del cliente
En **Mis pedidos** y en el comprobante hay una **línea de tiempo** con la fecha y hora de cada estatus. Se actualiza sola cada 15 segundos (consulta periódica, no es instantánea).

### Dashboard y reportes (administrador, HU11)
- **Dashboard:** ventas y pedidos de hoy, entregas pendientes, pedidos por estatus, alertas de reorden, próximas entregas, ventas de 7 días y dos avisos importantes: **pagos cobrados sin pedido** (hay que reembolsarlos a mano en la pasarela) y **correos que no han podido enviarse**.
- **Reportes:** *Ventas por periodo* (por día, semana o mes: ventas, costo de insumos y utilidad bruta, más productos más vendidos), *Pedidos por estatus* y *Existencias de inventario* con su valor. Se presentan en **tablas contables** (importes alineados a la derecha, totales con raya y doble raya). Cada reporte se puede **descargar en CSV para Excel** o **imprimir / guardar como PDF**.
- Los días se cuentan con la **hora de México** (un pedido de las 11:30 pm cuenta ese día aunque en UTC ya sea el siguiente).
- El *costo de insumos* usa los **costos unitarios vigentes**: si cambias el precio de un insumo, cambia el costo de pedidos pasados en el reporte. Es un dato informativo, no contabilidad histórica.

### Rutas nuevas (Sprint 5)
| Método y ruta | Acceso | Descripción |
|---|---|---|
| GET `/api/cocina/pedidos?fecha=AAAA-MM-DD` | Cocina, admin | Tablero del día con fichas técnicas |
| GET `/api/cocina/pedidos/:id` | Cocina, admin | Ficha de un pedido |
| PATCH `/api/cocina/pedidos/:id/estatus` | Cocina, admin | Avanzar el estatus (`{"estatus":"En preparación"}`) |
| GET `/api/notificaciones?estado=` | Admin | Avisos por correo y su estado |
| POST `/api/notificaciones/:id/reintentar` | Admin | Reintentar un aviso con error |
| GET `/api/reportes/dashboard` | Admin | Resumen del día |
| GET `/api/reportes/ventas?desde&hasta&agrupar=dia\|semana\|mes` | Admin | Ventas, costo y utilidad (`&formato=csv` para descargar) |
| GET `/api/reportes/estatus?desde&hasta` | Admin | Pedidos por estatus |
| GET `/api/reportes/existencias` | Admin | Existencias y su valor |

## Sprint 6: entrega

### Lo nuevo
- **Mi cuenta:** cualquier persona cambia su contraseña. Al cambiarla (o al restablecerla el administrador) **se cierran todas las demás sesiones** (columna `usuarios.token_version`).
- **Pantallas del administrador:** *Usuarios* (alta, rol, baja, restablecer contraseña; protege al último administrador) y *Catálogo y precios* (productos y presentaciones).
- **Operación:** `GET /api/salud` (para monitoreo del hosting), apagado ordenado con SIGTERM y límite de intentos configurable (`AUTH_RATE_LIMIT`).
- **Scripts de despliegue:**
  - `npm run crear-admin` crea el primer administrador (`ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`; con `-- --reiniciar` restablece su contraseña).
  - `npm run verificar` revisa la configuración antes de publicar (✔ / ⚠ / ✖) y termina con error si hay algo que corregir.
  - `npm run db:seed` **ya no crea cuentas de prueba cuando `NODE_ENV=production`**.
  - `npm run instalar` (o `instalar.bat`) es el asistente de instalación; `npm run respaldo` guarda una copia de la base de datos en `respaldos/` (se conservan las últimas 14).
- **Seguridad:** barrido automático de permisos de **todas** las rutas con cada rol (una ruta nueva sin clasificar hace fallar la prueba), ataques a tokens, archivos internos no expuestos, cuerpos enormes (413), carga simultánea.
- **Documentación** (carpeta `docs/`): **Manual de usuario** (por rol, con capturas reales, plan de capacitación y lista de aceptación para la Product Owner) y **Documentación técnica** (arquitectura, datos, seguridad, API, pruebas, despliegue y mantenimiento). Vienen en Word y PDF.

### Para publicar el sistema
1. Crea una base PostgreSQL y define las variables de producción (`.env.example` explica cada una): `NODE_ENV=production`, `PUBLIC_URL` con https, `TRUST_PROXY=1`, `DATABASE_SSL=true` si aplica, `JWT_SECRET` largo y aleatorio, `PAYMENT_PROVIDER=stripe` con sus llaves y `MAIL_PROVIDER=smtp` o `resend`.
2. `npm install --omit=dev` → `npm run db:init` → (opcional) `npm run db:seed` → `npm run crear-admin`.
3. `npm run verificar` debe terminar en “Listo para publicar”.
4. Haz una compra real de bajo monto de punta a punta (pago, comprobante, correo, tablero y reembolso) antes de abrir al público.
5. Detalle completo, checklist de salida, respaldos y mantenimiento: **Documentación técnica, secciones 10 y 11**.

## Sprint 7: pedidos a proveedor, logotipo y paleta
Nuevo menú **Pedidos a proveedor** (solo administrador) con tres pestañas:
- **Proveedores:** agregar, editar y eliminar proveedores (nombre, correo, contacto, teléfono y qué insumos surte). Si el proveedor ya tiene pedidos, "eliminar" lo **archiva** para conservar el historial; si tiene pedidos sin recibir, no se deja eliminar.
- **Nuevo pedido:** se elige proveedor, insumos y cantidades (o el botón *Agregar lo que está en reorden*, que sugiere la cantidad para llegar al doble del mínimo), con una nota opcional. Al enviarlo se manda **un correo al proveedor** con cada insumo y su cantidad; sus respuestas llegan al correo del administrador (Reply-To).
- **Pedidos enviados:** historial con estado del correo, *Marcar recibido* y *Cancelar* (avisa al proveedor).
- **Suma al stock:** siempre **automática al enviar** el pedido (queda un movimiento de entrada con el folio PP-0001…). Nunca se suma dos veces. *Marcar recibido* solo cierra el pedido. (La API aún acepta `suma_stock_en: "recepcion"` y `fecha_requerida`, pero la pantalla ya no los ofrece.)
- El correo usa la misma bandeja con reintentos del Sprint 5: si falla el envío, el pedido queda registrado y el administrador puede reintentar.
- Variable opcional `EMPRESA_NOMBRE` (nombre en asunto y firma). Rutas nuevas: `/api/proveedores` y `/api/pedidos-proveedor` (solo admin).
- **Identidad visual:** logotipo en encabezado, inicio de sesión, favicon e ícono de celular; paleta: fondo `#917A79`, cacao `#3F210E` y oliva `#6A6141`.

## Sprint 8: publicar en internet y ajustes
- **Publicación en línea (modo demostración):** `render.yaml` crea en Render el sitio con un solo clic (*Blueprint*); la base de datos es externa en **Neon** (plan gratuito sin caducidad; se pega su `DATABASE_URL` directa, sin `-pooler`) para que dure todo el semestre, ya que la base gratuita de Render se borra a los 30 días. Con `MODO_DEMO=true` el sitio puede estar en internet con **pago y correo simulados** (no se cobra nada) y muestra un aviso en la página. Sin esa variable, el sistema sigue negándose a usar pago o correo simulados en producción. Guía paso a paso: `docs/Guia_Publicar_en_internet`.
- **`npm run start:nube`** (lo usa Render): crea las tablas, carga los datos de ejemplo solo si la base está vacía y crea el administrador con `ADMIN_EMAIL` / `ADMIN_PASSWORD` si aún no hay uno. No crea cuentas de prueba públicas. Si olvidas la contraseña: `ADMIN_REINICIAR=true` (ver `.env.example`).
- **Recetas y costeo:** el botón "Eliminar receta" se reemplazó por **"Eliminar producto"** (borra el producto y su receta; si ya tiene ventas se desactiva para conservar el historial). Se mantiene "Desactivar producto". Ruta nueva: `DELETE /api/admin/productos/:id`.
- **Color de fondo** `#917A79` (siempre claro, sin modo oscuro automático).

## Sprint 9: dirección de entrega y legibilidad
- **Dirección de entrega:** después de la fecha y hora, el cliente escribe código postal, colonia, calle, número exterior, número interior (opcional) y referencias (opcional). Al escribir el código postal se llenan las colonias y el municipio con el catálogo oficial de SEPOMEX para Veracruz (`src/data/cp-veracruz.json`, 2 349 códigos; si el código tiene una sola colonia se elige sola). Si el código no está en el catálogo se escriben colonia y municipio a mano. El servidor valida todo (la colonia debe pertenecer al código postal) y calcula el municipio; la dirección no se exige al cotizar, solo al pagar.
- **Se muestra en:** comprobante y “Mis pedidos” del cliente, tablero y ficha técnica de cocina y administración (con referencias), y en el correo de confirmación. Los pedidos anteriores (sin dirección) siguen funcionando.
- Ruta nueva pública: `GET /api/catalogo/codigo-postal/:cp`. Columnas nuevas `dir_*` en `pedidos` (se agregan solas con `db/schema.sql`).
- **Legibilidad:** el texto de apoyo, títulos y botones que quedan directamente sobre el fondo `#917A79` usan un marrón más oscuro; los mensajes de error y éxito llevan su propio fondo claro. Se revisó el contraste de todas las pantallas con un navegador real.
- **Notificaciones del cliente:** pestaña nueva con globo de “sin leer”. Llega un aviso al confirmarse el pedido y otro en cada cambio de estatus (en preparación, listo, entregado), aunque el correo no esté configurado. Se puede marcar como leída, marcar todas, o abrir el pedido. Rutas: `/api/avisos` (solo cliente). Reutiliza los avisos del correo; columna nueva `leida_en` en `notificaciones`.
- Se retiró el cartel “Sitio de demostración” (el modo de pruebas sigue funcionando igual: pago y correo simulados).

## Probar que todo funciona
**Total verificado con esta versión: 749 pruebas (33 + 70 + 92 + 96 + 84 + 125 + 58 + 72 + 119), todas correctas.** El Sprint 9 se prueba con `npm run test:sprint9` (72). El Sprint 8 se prueba con `npm run test:sprint8` (58) y la interfaz con `npm run test:ui` (112).

- **Sprint 2:** con el servidor corriendo, `SEED_PASSWORD=tu_clave BASE_URL=http://localhost:3000 npm run test:smoke` (33 pruebas: registro, login, roles, catálogo, administración y ataques básicos).
- **Sprint 3:** primero `npm run db:init` (agrega las tablas nuevas) y luego `npm run test:sprint3` (70 pruebas: validaciones, flujo de pago, webhook con firma y pagos simultáneos). No necesita el servidor encendido.

Ambas crean datos de prueba: úsalas **solo en tu base de desarrollo**. La del Sprint 3 los borra y restaura el inventario al terminar.

## Estructura
```
db/schema.sql          Modelo completo de datos (usuarios, insumos, productos, recetas, pedidos, pagos...)
scripts/               init-db.js (crea tablas) y seed.js (datos iniciales)
src/app.js, server.js  Servidor Express
src/middleware/auth.js Verifica token y rol (el rol se lee de la BD en cada petición)
src/routes/            auth.js, catalog.js, admin.js
src/services/pedidos.js Validación del combo, checkout y confirmación de pago (transacción)
src/routes/inventario.js, recetas.js  Inventario con movimientos y alertas; recetas con costeo
src/routes/cocina.js, reportes.js, notificaciones.js  Tablero y estatus; dashboard y reportes; avisos por correo
src/services/notificaciones.js  Bandeja de salida con reintentos
src/mail/             Correo: consola.js, smtp.js, resend.js y brevo.js
src/payments/         Pasarelas: simulado.js y stripe.js
render.yaml, scripts/preparar-nube.js  Publicación en Render (Sprint 8)
src/routes/proveedores.js, pedidosProveedor.js  Proveedores y pedidos de insumos; src/services/compras.js (transacción: pedido + correo + stock)
public/compras.js      Pantalla "Pedidos a proveedor"; logo*.png, favicon.png, apple-touch-icon.png
public/                Pantalla del cliente (app.js) y del personal: personal.js (inventario y recetas), cocina.js (tablero), reportes.js (dashboard y reportes)
```

## API (Sprint 2)
| Método y ruta | Acceso | Descripción |
|---|---|---|
| POST `/api/auth/register` | Público | Crea una cuenta de **cliente** |
| POST `/api/auth/login` | Público | Devuelve token (8 h) y datos del usuario |
| GET `/api/auth/me` | Sesión | Usuario actual |
| GET `/api/catalogo` | Público | Productos y presentaciones activos |
| GET/POST `/api/admin/productos` | Admin | Listar / crear producto (nace inactivo) |
| PUT `/api/admin/productos/:id` | Admin | Editar nombre, descripción y precio |
| PATCH `/api/admin/productos/:id/activo` | Admin | Activar/desactivar (solo si tiene receta) |
| GET/PUT `/api/admin/presentaciones` | Admin | Listar / cambiar precio o estado |
| GET/POST `/api/admin/usuarios` | Admin | Listar / dar de alta personal (cocina, almacen, admin) |
| PATCH `/api/admin/usuarios/:id` | Admin | Cambiar rol o dar de baja (nunca deja al sistema sin admin) |

Las peticiones protegidas llevan el encabezado `Authorization: Bearer <token>`.

## Seguridad aplicada
Contraseñas con bcrypt, consultas parametrizadas (sin inyección SQL), límite de intentos en login/registro, cabeceras de `helmet`, validación de datos en el servidor, secretos solo en `.env`, y el registro público nunca puede crear personal.

## Trabajo futuro
Recuperación de contraseña por correo, reembolsos desde el sistema, costos históricos por pedido y más: ver la **Documentación técnica, sección 13**.

---

## ComboWeb Decisiones (proyecto de comboweb-decisiones)

Es ComboWeb App más la pestaña **Toma de decisiones** del administrador, con dos partes:

### 1. Pantalla en Angular
- El código fuente está en `angular-decisiones/` (Angular 22, componentes y señales, sin otras librerías de interfaz ni de gráficas).
- Ya viene **compilado** en `public/decisiones-ng/`; el servidor lo entrega tal cual, por eso Render no necesita compilarlo.
- La pestaña del sistema (`public/decisiones.js`) la muestra dentro de un marco de la misma página y reutiliza la sesión del administrador.
- Si cambias algo del código de Angular, vuelve a compilar:  `npm run angular:compilar`  (requiere internet la primera vez; deja el resultado en `public/decisiones-ng/`).
- Nota: un framework no oculta el código (el navegador siempre recibe la pantalla). Lo que protege el sistema es lo que está en el servidor: sesiones, permisos por rol, validaciones y cálculos.

### 2. Toma de decisiones
- 3 casos de ejemplo (combo de temporada, producción diaria, proveedor) con matriz de pagos editable.
- 6 criterios: Maximin, Maximax, Laplace, Hurwicz (α), Savage y VME, más el consenso entre ellos.
- "Guardar como mis datos" guarda la matriz editada; "Volver a los datos de ejemplo" la restaura.
- Las decisiones se registran con la matriz y lo que decía cada criterio.
- API (solo administrador): `/api/decisiones/*`.

### 3. Data warehouse (esquema de estrella en PostgreSQL, schema `dw`)
- Hechos: `dw.fact_ventas` (una fila por pedido entregado). Dimensiones: `dw.dim_fecha`, `dw.dim_combo`, `dw.dim_presentacion`.
- Combos: Combo Otoño (Té chai + Galleta), Combo Navideño (Café latte + Brownie), Combo San Valentín (Cupcake + Café latte), Combo Regreso a clases (Galleta + Café americano) y Combo personalizado (cualquier otra mezcla que elija el cliente). Se definen en `src/services/combos.js`.
- ETL: extrae de `pedidos`, `pedido_items` y `movimientos_inventario`, clasifica cada pedido en su combo y carga. Se puede repetir sin duplicar y se vuelve a sincronizar solo si deja de coincidir con el sistema.
- Las ventas de demostración (12 meses, con temporadas) se registran como **pedidos reales entregados** de un cliente inactivo (`ventas.demo@encombo.test`). Por eso el Dashboard, Reportes y Toma de decisiones muestran exactamente los mismos números. Se cargan solas al preparar la nube; `VENTAS_DEMO=false` las desactiva. Comandos: `npm run ventas-demo` y `npm run ventas-demo:quitar`.
- Panel con indicadores, ventas por combo, una línea de conciliación con Reportes y "Exportar para Power BI" (4 CSV: 3 dimensiones y los hechos).
- API (solo administrador): `/api/warehouse/*`.

### 4. Protección del código en el navegador
- El servidor entrega los `.js` y `.css` de `public/` minificados (esbuild), sin comentarios ni mapas de código (`src/middleware/minificar.js`). `npm run test:proteccion` lo comprueba.
- Aun así, lo que llega al navegador siempre se puede ver con F12: la protección real está en el servidor (sesiones, permisos por rol, validaciones, cálculos) y en mantener el repositorio privado.

### Pruebas
`npm run test:decisiones`, `npm run test:warehouse`, `npm run test:proteccion`, `npm run test:ui` y las anteriores. La prueba de la pantalla Angular en un navegador real es `npm run test:angular` (necesita `npm i --no-save playwright && npx playwright install chromium`).


---

## Novedades (versión 1.1.0)

- **Olvidé mi contraseña:** en la pantalla de entrada, "¿Olvidaste tu contraseña?" envía un enlace al correo (vence en 1 hora y sirve una sola vez; solo se guarda su hash; máximo 3 por hora y por cuenta). Al usarlo se cierran las sesiones abiertas. Si el correo no puede enviarse (modo demostración), el administrador sigue pudiendo restablecerla desde la pestaña Usuarios. Límite por IP ajustable con `AUTH_RATE_LIMIT_OLVIDE` (por defecto 5 cada 15 minutos).
- **Dependencias actualizadas:** sin vulnerabilidades conocidas (`npm audit` reporta 0).
- **Sesión más segura:** una consulta lenta hecha con la sesión anterior ya no cierra la sesión nueva justo después de cambiar la contraseña.
- **Servidor lento:** si al abrir el sistema el servidor tarda en responder, se reintenta unas veces y se avisa en pantalla.
- **Pruebas automáticas en GitHub:** `.github/workflows/pruebas.yml` corre todas las pruebas en cada subida y muestra ✓ o ✗ en el repositorio. Usa una base de datos temporal, no la de Neon.
- Pruebas nuevas: `npm run test:sprint10`.
- **Correo por Brevo:** nuevo `MAIL_PROVIDER=brevo` (API por HTTPS), que funciona en Render gratis. Variables: `BREVO_API_KEY` y `MAIL_FROM`.

- **Margen del warehouse más realista:** el costo de cada producto ahora suma los ingredientes más 30 % del precio de lista por costos indirectos (mano de obra, gas, empaque). Después los costos de insumos de la demostración se ajustaron para un margen cercano a 58 %.
