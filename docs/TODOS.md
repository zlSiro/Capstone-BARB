Sí se puede, pero no lo cambié: está fuera del alcance del spec 02 y no quiero mezclarlo en esta rama.

Cómo: en frontend/angular.json:38, subir maximumWarning de "600kB" a por ejemplo "700kB". Hoy el bundle inicial pesa unos 624 kB, y el error duro (maximumError) está en 1 MB, así que hay margen.

Por qué conviene dejarlo para otro cambio:
- Subir el límite solo silencia el aviso. El bundle ya venía por encima de 600 kB antes de este spec (unos 20 kB de exceso) y mis cambios sumaron unos 4 kB, casi todos claves i18n en translations.ts.
- La alternativa de fondo es reducir el bundle inicial. Por ejemplo, cargar de forma perezosa los textos por vista, o revisar qué librerías entran en el bundle inicial. Cambia el diseño, así que es otra decisión.
- El presupuesto es acuerdo del equipo, no una opción personal.

Lo anoto como pendiente para un spec o PR aparte. Si prefieres hacerlo ahora igual, dime y lo cambio en un commit separado.

¿Seguimos con el Paso 11 (docs y contratos)?