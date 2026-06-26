import logging
import os
import sys

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.auth import verify_bearer_token
from app.config import get_settings
from app.models import PortfolioResponse
from app.robinhood_service import build_portfolio_response

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("portfolio-api")

app = FastAPI(
    title="Robinhood Portfolio API",
    description="Read-only portfolio connector for Trading MCP",
    version="1.0.0",
)


@app.on_event("startup")
def validate_configuration() -> None:
    try:
        get_settings()
        logger.info("Portfolio API configuration loaded")
    except RuntimeError as exc:
        logger.error("Startup configuration error: %s", exc)
        raise


cors_origins = os.getenv("CORS_ORIGINS", "").strip()
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in cors_origins.split(",") if origin.strip()],
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Authorization"],
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/portfolio/{account_number}", response_model=PortfolioResponse)
def get_portfolio(
    account_number: str,
    _: str = Depends(verify_bearer_token),
) -> PortfolioResponse:
    if not account_number.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="account_number is required",
        )

    try:
        return build_portfolio_response(account_number.strip())
    except RuntimeError as exc:
        message = str(exc)
        logger.warning("Portfolio request failed for account=%s", account_number)
        if "login" in message.lower():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=message,
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=message,
        ) from exc
    except Exception as exc:
        logger.error(
            "Unexpected portfolio error for account=%s: %s",
            account_number,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unexpected error while building portfolio response",
        ) from exc
