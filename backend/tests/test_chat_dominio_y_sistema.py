"""Tests para la delimitación estricta de dominio y la documentación del sistema en DocChat.

Verifica:
1. Que el prompt del sistema contenga la documentación del sistema informático BARB para usuarios.
2. Que el prompt del sistema contenga las reglas estrictas de delimitación de dominio:
   - Prohibición de chistes y juegos (incluyendo intentos de que el bot cuente o escuche chistes).
   - Prohibición de responder sobre temas no industriales (comida, gastronomía típica, turismo, etc.).
   - Restricción estricta a máquinas y manuales de la empresa (sin inventar ni responder con conocimiento
     general de internet sobre maquinaria externa no registrada).
3. Que la cadena multimodal también herede las restricciones de dominio.
"""

from barb.services.chat_graph import _prompt_sistema
from barb.services.llm_service import (
    _MULTIMODAL_VISUAL_INSTRUCTIONS,
    DOCUMENTACION_SISTEMA_USUARIO,
    REGLAS_DELIMITACION_DOMINIO,
    create_conversation_chain,
)


def test_prompt_sistema_contiene_documentacion_sistema_barb():
    """El prompt del sistema debe cargar la guía de usuario del sistema informático BARB."""
    prompt = _prompt_sistema("(sin fragmentos)")

    assert "DOCUMENTACIÓN DEL SISTEMA INFORMÁTICO BARB (PARA USUARIOS)" in prompt
    assert DOCUMENTACION_SISTEMA_USUARIO in prompt
    assert "¿Qué es BARB?" in prompt
    assert "DocChat (Asistente de Mantenimiento con IA)" in prompt
    assert "Órdenes de Trabajo (OT)" in prompt
    assert "Avisos de Falla" in prompt
    assert "Topología y Mantenedor de Plantas y Máquinas" in prompt
    assert "Módulo de Documentos" in prompt
    assert "Dashboard y Métricas" in prompt
    assert "Historial y Auditoría" in prompt
    assert "de qué se trata el sistema" in prompt
    assert "cómo funciona el sistema" in prompt


def test_prompt_sistema_contiene_delimitacion_estricta_de_dominio():
    """El prompt del sistema debe prohibir chistes, comida y maquinaria externa de internet."""
    prompt = _prompt_sistema("(sin fragmentos)")

    # Delimitación y rechazo
    assert "DELIMITACIÓN ESTRICTA DE DOMINIO Y RECHAZO DE TEMAS IRRELEVANTES" in prompt
    assert REGLAS_DELIMITACION_DOMINIO in prompt

    # 1. Prohibición de chistes
    assert "PROHIBICIÓN TOTAL DE CHISTES Y ENTRETENIMIENTO" in prompt
    assert "TERMINANTEMENTE PROHIBIDO contar chistes" in prompt
    assert "«¿te cuento un chiste?»" in prompt or "«te puedo contar uno yo»" in prompt
    assert "NUNCA digas «¡Claro que sí!»" in prompt

    # 2. Prohibición de comida y temas fuera de dominio
    assert "PROHIBICIÓN DE TEMAS FUERA DE DOMINIO" in prompt
    assert "comida, gastronomía o platos típicos" in prompt
    assert "se me cayó mi helado" in prompt

    # 3. Restricción de máquinas a catálogo y manuales de la empresa
    assert "RESTRICCIÓN ESTRICTA A MÁQUINAS Y MANUALES DE LA EMPRESA" in prompt
    assert "NO USAR INTERNET NI CONOCIMIENTO EXTERNO" in prompt
    assert "NO recomiendes maquinaria externa de internet" in prompt


def test_cadena_conversacional_contiene_documentacion_y_delimitacion():
    """create_conversation_chain debe incluir la documentación y delimitación de dominio en su prompt."""
    chain = create_conversation_chain()
    # Inspeccionar el system message del template (segundo paso del RunnableSequence)
    prompt_template = chain.middle[0]
    system_text = prompt_template.messages[0].prompt.template

    assert "DOCUMENTACIÓN DEL SISTEMA INFORMÁTICO BARB" in system_text
    assert "DELIMITACIÓN ESTRICTA DE DOMINIO" in system_text
    assert "PROHIBICIÓN TOTAL DE CHISTES" in system_text
    assert "comida, gastronomía o platos típicos" in system_text


def test_instrucciones_multimodales_contienen_delimitacion_de_dominio():
    """El system prompt del análisis de imágenes debe mantener las restricciones de dominio."""
    assert "DELIMITACIÓN ESTRICTA DE DOMINIO" in _MULTIMODAL_VISUAL_INSTRUCTIONS
    assert "PROHIBICIÓN TOTAL DE CHISTES" in _MULTIMODAL_VISUAL_INSTRUCTIONS
    assert "comida, gastronomía o platos típicos" in _MULTIMODAL_VISUAL_INSTRUCTIONS
