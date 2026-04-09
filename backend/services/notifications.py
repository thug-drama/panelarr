from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
import time
import uuid
from email.message import EmailMessage

import httpx

from backend.services.config import load_config, save_config

logger = logging.getLogger(__name__)

API_TIMEOUT = 10

DEFAULT_COOLDOWNS: dict[str, int] = {
    "health_check": 0,
    "disk_warning": 3600,
    "disk_critical": 1800,
}

_last_notified: dict[str, float] = {}


def _generate_id() -> str:
    return uuid.uuid4().hex[:12]


def _get_notifications(data: dict) -> dict:
    """Get the notifications section from config data."""
    return data.get("notifications", {"channels": [], "rules": []})


def _get_channels(data: dict) -> list[dict]:
    return _get_notifications(data).get("channels", [])


def _get_rules(data: dict) -> list[dict]:
    return _get_notifications(data).get("rules", [])


async def _send_discord(webhook_url: str, title: str, body: str, color: int = 0x6366F1) -> bool:
    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            resp = await client.post(
                webhook_url,
                json={"embeds": [{"title": title, "description": body, "color": color}]},
            )
            return resp.status_code in (200, 204)
    except Exception as exc:
        logger.warning("Discord send error: %s", exc)
        return False


async def _send_telegram(bot_token: str, chat_id: str, title: str, body: str) -> bool:
    try:
        text = f"<b>{title}</b>\n\n{body}"
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            )
            return resp.status_code == 200
    except Exception as exc:
        logger.warning("Telegram send error: %s", exc)
        return False


async def _send_slack(webhook_url: str, title: str, body: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            resp = await client.post(
                webhook_url,
                json={
                    "blocks": [
                        {"type": "header", "text": {"type": "plain_text", "text": title}},
                        {"type": "section", "text": {"type": "mrkdwn", "text": body}},
                    ]
                },
            )
            return resp.status_code == 200
    except Exception as exc:
        logger.warning("Slack send error: %s", exc)
        return False


async def _send_webhook(url: str, title: str, body: str, event: str = "") -> bool:
    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            resp = await client.post(
                url,
                json={"title": title, "body": body, "event": event, "source": "panelarr"},
            )
            return resp.status_code in (200, 201, 204)
    except Exception as exc:
        logger.warning("Webhook send error: %s", exc)
        return False


def _smtp_send_blocking(
    host: str,
    port: int,
    username: str,
    password: str,
    from_addr: str,
    to_addrs: list[str],
    title: str,
    body: str,
    encryption: str,
) -> bool:
    msg = EmailMessage()
    msg["Subject"] = title
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    msg.set_content(body)

    context = ssl.create_default_context()
    try:
        if encryption == "ssl":
            with smtplib.SMTP_SSL(host, port, timeout=API_TIMEOUT, context=context) as smtp:
                if username:
                    smtp.login(username, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=API_TIMEOUT) as smtp:
                smtp.ehlo()
                if encryption == "starttls":
                    smtp.starttls(context=context)
                    smtp.ehlo()
                if username:
                    smtp.login(username, password)
                smtp.send_message(msg)
        return True
    except Exception as exc:
        logger.warning("Email send error: %s", exc)
        return False


async def _send_email(cfg: dict, title: str, body: str) -> bool:
    host = (cfg.get("smtp_host") or "").strip()
    if not host:
        logger.warning("Email channel missing smtp_host")
        return False
    try:
        port = int(cfg.get("smtp_port") or 587)
    except (TypeError, ValueError):
        port = 587

    from_addr = (cfg.get("from_addr") or "").strip()
    to_field = cfg.get("to_addrs") or ""
    to_addrs = [addr.strip() for addr in to_field.split(",") if addr.strip()]
    if not from_addr or not to_addrs:
        logger.warning("Email channel missing from_addr or to_addrs")
        return False

    username = cfg.get("username") or ""
    password = cfg.get("password") or ""

    encryption = (cfg.get("encryption") or "").strip().lower()
    if not encryption:
        # Backwards-compat with the older two-checkbox shape
        if cfg.get("use_tls"):
            encryption = "ssl"
        elif cfg.get("use_starttls", True):
            encryption = "starttls"
        else:
            encryption = "none"
    if encryption not in {"ssl", "starttls", "none"}:
        encryption = "starttls"

    return await asyncio.to_thread(
        _smtp_send_blocking,
        host,
        port,
        username,
        password,
        from_addr,
        to_addrs,
        title,
        body,
        encryption,
    )


async def send_to_channel(channel: dict, title: str, body: str, color: int = 0x6366F1) -> bool:
    ch_type = channel.get("type", "")
    cfg = channel.get("config", {})

    if ch_type == "discord":
        return await _send_discord(cfg.get("webhook_url", ""), title, body, color)
    elif ch_type == "telegram":
        return await _send_telegram(cfg.get("bot_token", ""), cfg.get("chat_id", ""), title, body)
    elif ch_type == "slack":
        return await _send_slack(cfg.get("webhook_url", ""), title, body)
    elif ch_type == "webhook":
        return await _send_webhook(cfg.get("url", ""), title, body)
    elif ch_type == "email":
        return await _send_email(cfg, title, body)
    else:
        logger.warning("Unknown channel type: %s", ch_type)
        return False


async def notify_event(
    event: str, title: str, body: str, color: int = 0x6366F1, *, force: bool = False
) -> dict[str, object]:
    if not force:
        cooldown = DEFAULT_COOLDOWNS.get(event, 3600)
        if cooldown > 0:
            last = _last_notified.get(event, 0)
            elapsed = time.monotonic() - last
            if elapsed < cooldown:
                return {"sent": 0, "failed": 0, "cooldown": int(cooldown - elapsed)}

    config = load_config()
    data = config.model_dump()
    channels_list = _get_channels(data)
    channels = {ch["id"]: ch for ch in channels_list}
    rules = _get_rules(data)

    sent = 0
    failed = 0
    for rule in rules:
        if not rule.get("enabled", True):
            continue
        if rule.get("event") != event:
            continue
        channel = channels.get(rule.get("channel_id", ""))
        if not channel or not channel.get("enabled", True):
            continue
        ok = await send_to_channel(channel, title, body, color)
        if ok:
            sent += 1
        else:
            failed += 1

    if sent > 0:
        _last_notified[event] = time.monotonic()

    return {"sent": sent, "failed": failed}


def get_channels() -> list[dict]:
    config = load_config()
    return _get_channels(config.model_dump())


def add_channel(channel_data: dict) -> dict:
    config = load_config()
    data = config.model_dump()
    notifications = _get_notifications(data)
    channels = notifications.get("channels", [])
    new_channel = {
        "id": _generate_id(),
        "type": channel_data.get("type", "webhook"),
        "name": channel_data.get("name", "Unnamed"),
        "config": channel_data.get("config", {}),
        "enabled": channel_data.get("enabled", True),
    }
    channels.append(new_channel)
    notifications["channels"] = channels
    data["notifications"] = notifications
    save_config(PanelarrConfig(**data))
    return new_channel


def update_channel(channel_id: str, updates: dict) -> dict | None:
    config = load_config()
    data = config.model_dump()
    notifications = _get_notifications(data)
    channels = notifications.get("channels", [])
    for ch in channels:
        if ch["id"] == channel_id:
            for key in ("name", "type", "config", "enabled"):
                if key in updates:
                    ch[key] = updates[key]
            notifications["channels"] = channels
            data["notifications"] = notifications
            save_config(PanelarrConfig(**data))
            return ch
    return None


def delete_channel(channel_id: str) -> bool:
    config = load_config()
    data = config.model_dump()
    notifications = _get_notifications(data)
    channels = notifications.get("channels", [])
    new_channels = [ch for ch in channels if ch["id"] != channel_id]
    if len(new_channels) == len(channels):
        return False
    rules = notifications.get("rules", [])
    notifications["rules"] = [r for r in rules if r.get("channel_id") != channel_id]
    notifications["channels"] = new_channels
    data["notifications"] = notifications
    save_config(PanelarrConfig(**data))
    return True


def get_rules() -> list[dict]:
    config = load_config()
    return _get_rules(config.model_dump())


def add_rule(rule_data: dict) -> dict:
    config = load_config()
    data = config.model_dump()
    notifications = _get_notifications(data)
    rules = notifications.get("rules", [])
    new_rule = {
        "id": _generate_id(),
        "event": rule_data.get("event", ""),
        "channel_id": rule_data.get("channel_id", ""),
        "schedule": rule_data.get("schedule"),
        "enabled": rule_data.get("enabled", True),
    }
    rules.append(new_rule)
    notifications["rules"] = rules
    data["notifications"] = notifications
    save_config(PanelarrConfig(**data))
    return new_rule


def delete_rule(rule_id: str) -> bool:
    config = load_config()
    data = config.model_dump()
    notifications = _get_notifications(data)
    rules = notifications.get("rules", [])
    new_rules = [r for r in rules if r["id"] != rule_id]
    if len(new_rules) == len(rules):
        return False
    notifications["rules"] = new_rules
    data["notifications"] = notifications
    save_config(PanelarrConfig(**data))
    return True


# Import PanelarrConfig at the end to avoid circular imports
from backend.services.config import PanelarrConfig  # noqa: E402
