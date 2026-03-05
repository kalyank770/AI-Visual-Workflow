"""MCP tool registry and dispatch helpers."""
from __future__ import annotations

from typing import Any

from backend.tools.mcp_tools import (
    execute_tool_call,
    tool_calculator,
    tool_currency,
    tool_dictionary,
    tool_stock_analysis,
    tool_stock_price,
    tool_unit_converter,
    tool_weather,
    tool_web_search,
    tool_wikipedia,
    tool_world_clock,
)


TOOL_SPECS: dict[str, dict[str, Any]] = {
    "stock_price": {
        "name": "stock_price",
        "description": "Current stock price for a company or ticker.",
        "input_schema": {
            "type": "object",
            "properties": {"entity": {"type": "string"}},
            "required": ["entity"],
        },
        "handler": tool_stock_price,
    },
    "stock_analysis": {
        "name": "stock_analysis",
        "description": "Stock trend context for forecast questions.",
        "input_schema": {
            "type": "object",
            "properties": {"entity": {"type": "string"}},
            "required": ["entity"],
        },
        "handler": tool_stock_analysis,
    },
    "weather": {
        "name": "weather",
        "description": "Current weather for a city or location.",
        "input_schema": {
            "type": "object",
            "properties": {"entity": {"type": "string"}},
            "required": ["entity"],
        },
        "handler": tool_weather,
    },
    "wikipedia": {
        "name": "wikipedia",
        "description": "Wikipedia summary for a topic.",
        "input_schema": {
            "type": "object",
            "properties": {"entity": {"type": "string"}},
            "required": ["entity"],
        },
        "handler": tool_wikipedia,
    },
    "web_search": {
        "name": "web_search",
        "description": "DuckDuckGo instant answer search.",
        "input_schema": {
            "type": "object",
            "properties": {"entity": {"type": "string"}},
            "required": ["entity"],
        },
        "handler": tool_web_search,
    },
    "dictionary": {
        "name": "dictionary",
        "description": "Definition and phonetics for a word.",
        "input_schema": {
            "type": "object",
            "properties": {"entity": {"type": "string"}},
            "required": ["entity"],
        },
        "handler": tool_dictionary,
    },
    "calculator": {
        "name": "calculator",
        "description": "Evaluate a math expression.",
        "input_schema": {
            "type": "object",
            "properties": {"entity": {"type": "string"}},
            "required": ["entity"],
        },
        "handler": tool_calculator,
    },
    "unit_converter": {
        "name": "unit_converter",
        "description": "Convert between length units.",
        "input_schema": {
            "type": "object",
            "properties": {"entity": {"type": "string"}},
            "required": ["entity"],
        },
        "handler": tool_unit_converter,
    },
    "world_clock": {
        "name": "world_clock",
        "description": "Current time in a city or timezone.",
        "input_schema": {
            "type": "object",
            "properties": {"entity": {"type": "string"}},
            "required": ["entity"],
        },
        "handler": tool_world_clock,
    },
    "currency": {
        "name": "currency",
        "description": "Convert currencies using live rates.",
        "input_schema": {
            "type": "object",
            "properties": {
                "from_currency": {"type": "string"},
                "to_currency": {"type": "string"},
                "amount": {"type": "number"},
                "entity": {"type": "string"},
            },
            "required": [],
        },
        "handler": tool_currency,
    },
}


def list_tools() -> list[dict[str, Any]]:
    return [
        {
            "name": spec["name"],
            "description": spec["description"],
            "input_schema": spec["input_schema"],
        }
        for spec in TOOL_SPECS.values()
    ]


def _extract_entity(params: dict[str, Any] | None) -> str:
    if not params:
        return ""
    for key in ("entity", "input", "query"):
        value = params.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def call_tool(name: str, params: dict[str, Any] | None, original_prompt: str = "") -> str | None:
    if name not in TOOL_SPECS:
        return None

    if name == "currency":
        if params:
            from_currency = params.get("from_currency")
            to_currency = params.get("to_currency")
            amount = params.get("amount", 1.0)
            if isinstance(from_currency, str) and isinstance(to_currency, str):
                return tool_currency(from_currency, to_currency, float(amount))
        entity = _extract_entity(params)
        if entity:
            return execute_tool_call("currency", entity, original_prompt=original_prompt)
        return None

    entity = _extract_entity(params)
    if not entity:
        return None

    return execute_tool_call(name, entity, original_prompt=original_prompt)
