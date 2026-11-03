// Textos de la vista «acceso». `en` está tipado como `typeof es`: no puede faltarle ni sobrarle una clave.
const es = {
  acceso: {
    sistema_de_mantenimiento_de: 'Sistema de mantenimiento de planta',
    usuario: 'Usuario',
    contrasena: 'Contraseña',
    ingresando: 'Ingresando...',
    ingresar: 'Ingresar',
    usuario_o_contrasena_incorrect: 'Usuario o contraseña incorrecta',
    cambiar_idioma: 'Cambiar idioma',
  },
};

const en: typeof es = {
  acceso: {
    sistema_de_mantenimiento_de: 'Plant maintenance system',
    usuario: 'User',
    contrasena: 'Password',
    ingresando: 'Signing in...',
    ingresar: 'Sign in',
    usuario_o_contrasena_incorrect: 'Incorrect username or password',
    cambiar_idioma: 'Change language',
  },
};

export const accesoTextos = { es, en };
