"""Parámetros declarativos por modelo (HU-22 / CGBIDA-443).

La HU pide que cada modelo del sistema (chat textual y multimodal) declare sus
parámetros en un único lugar, para que nadie tenga que adivinar `temperature`,
`timeout` o `reasoning` al agregar un modelo. Ese lugar es `MODEL_SETTINGS`
(`core/config.py`) y `llm_service` lo consume: estos tests fijan el contrato.
"""

from __future__ import annotations

from dataclasses import replace

from barb.core.config import MODEL_SETTINGS, ModelSettings, settings
from barb.services import llm_service


def test_el_registro_declara_los_dos_modelos_del_sistema():
    assert {"texto", "multimodal"} <= set(MODEL_SETTINGS)


def test_cada_modelo_declara_sus_parametros():
    for rol, cfg in MODEL_SETTINGS.items():
        assert cfg.model, f"{rol} no declara el id del modelo"
        assert cfg.temperature >= 0, f"{rol} no declara temperatura"
        assert cfg.max_tokens > 0, f"{rol} no declara max_tokens"
        assert cfg.timeout is None or cfg.timeout > 0, f"{rol} declara un timeout inválido"


def test_el_multimodal_declara_su_reasoning():
    """`muse-glimmer` necesita «Reasoning strength: low» o devuelve `content` vacío."""
    assert MODEL_SETTINGS["multimodal"].reasoning == "low"
    assert MODEL_SETTINGS["multimodal"].reasoning_suffix == "\nReasoning strength: low"

    # El chat textual no usa esa línea: su prefijo de razonamiento es enable_thinking.
    assert MODEL_SETTINGS["texto"].reasoning is None
    assert MODEL_SETTINGS["texto"].reasoning_suffix == ""


def test_un_modelo_nuevo_se_declara_solo_en_el_registro():
    """Agregar un modelo no obliga a tocar `llm_service`: basta con su entrada."""
    nuevo = ModelSettings(
        model="modelo-nuevo",
        temperature=0.3,
        max_tokens=512,
        timeout=30,
        reasoning="medium",
    )
    assert nuevo.model == "modelo-nuevo"
    assert nuevo.reasoning_suffix == "\nReasoning strength: medium"


def test_el_cliente_textual_usa_los_parametros_de_su_entrada(monkeypatch):
    monkeypatch.setattr(settings, "nvidia_api_key", "key-de-prueba")
    cfg = replace(
        MODEL_SETTINGS["texto"],
        temperature=0.42,
        max_tokens=321,
        timeout=45,
        enable_thinking=True,
    )
    monkeypatch.setitem(MODEL_SETTINGS, "texto", cfg)

    llm = llm_service._build_llm("nvidia")

    assert llm.model_name == cfg.model
    assert llm.temperature == 0.42
    assert llm.max_tokens == 321
    assert llm.request_timeout == 45
    assert llm.extra_body == {"chat_template_kwargs": {"enable_thinking": True}}


def test_el_cliente_multimodal_usa_los_parametros_de_su_entrada(monkeypatch):
    """Antes el multimodal leía LLM_TEMPERATURE y LLM_MAX_TOKENS: ahora tiene los suyos."""
    monkeypatch.setattr(settings, "nvidia_multimodal_api_key", "key-de-prueba")
    cfg = replace(
        MODEL_SETTINGS["multimodal"],
        temperature=0.55,
        max_tokens=777,
        timeout=33,
    )
    monkeypatch.setitem(MODEL_SETTINGS, "multimodal", cfg)

    llm = llm_service._build_multimodal_llm()

    assert llm.model_name == cfg.model
    assert llm.temperature == 0.55
    assert llm.max_tokens == 777
    assert llm.request_timeout == 33


def test_cada_modelo_lee_su_propia_configuracion():
    assert MODEL_SETTINGS["texto"].temperature == settings.llm_temperature
    assert MODEL_SETTINGS["multimodal"].temperature == settings.multimodal_temperature


def test_cambiar_la_temperatura_del_chat_no_mueve_el_multimodal(monkeypatch):
    """Cada modelo declara la suya: LLM_TEMPERATURE ya no gobierna el análisis de imágenes."""
    antes = MODEL_SETTINGS["multimodal"].temperature

    monkeypatch.setattr(settings, "llm_temperature", 0.9)

    assert MODEL_SETTINGS["multimodal"].temperature == antes
