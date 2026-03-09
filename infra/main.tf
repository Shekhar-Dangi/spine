# ---------------------------------------------------------------------------
# Resource Group
# ---------------------------------------------------------------------------

resource "azurerm_resource_group" "spine" {
  name     = "rg-spine-${var.env}"
  location = var.location
  tags     = local.common_tags
}

# ---------------------------------------------------------------------------
# PostgreSQL Flexible Server
# ---------------------------------------------------------------------------

resource "azurerm_postgresql_flexible_server" "spine" {
  # Name must be globally unique across Azure — change if taken
  name                   = "psql-spine-${var.env}"
  resource_group_name    = azurerm_resource_group.spine.name
  location               = azurerm_resource_group.spine.location
  version                = "17"
  administrator_login    = "spineadmin"
  administrator_password = var.db_password
  storage_mb             = 32768
  sku_name               = "B_Standard_B1ms"
  backup_retention_days  = 7
  zone                   = "1"
  tags                   = local.common_tags
}

resource "azurerm_postgresql_flexible_server_database" "spine" {
  name      = "spine"
  server_id = azurerm_postgresql_flexible_server.spine.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# Whitelist pgvector — Alembic migration runs CREATE EXTENSION IF NOT EXISTS vector
resource "azurerm_postgresql_flexible_server_configuration" "pgvector" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.spine.id
  value     = "VECTOR"
}

# Allow Azure-hosted services (App Service) to reach the DB
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_postgresql_flexible_server.spine.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# ---------------------------------------------------------------------------
# App Service Plan
# ---------------------------------------------------------------------------

resource "azurerm_service_plan" "spine" {
  name                = "asp-spine-${var.env}"
  resource_group_name = azurerm_resource_group.spine.name
  location            = azurerm_resource_group.spine.location
  os_type             = "Linux"
  sku_name            = "F1"
  tags                = local.common_tags
}

# ---------------------------------------------------------------------------
# Backend — FastAPI on Python 3.13
# ---------------------------------------------------------------------------

resource "azurerm_linux_web_app" "backend" {
  name                = "spine-api-${var.env}"
  resource_group_name = azurerm_resource_group.spine.name
  location            = azurerm_resource_group.spine.location
  service_plan_id     = azurerm_service_plan.spine.id
  https_only          = true
  tags                = local.common_tags

  site_config {
    application_stack {
      python_version = "3.13"
    }
    # startup.sh: mkdir /home dirs → alembic upgrade head → uvicorn
    app_command_line = "bash startup.sh"
    always_on        = false
  }

  app_settings = {
    # Database — SSL required on Azure PostgreSQL
    SPINE_DB_URL = "postgresql+asyncpg://spineadmin:${var.db_password}@${azurerm_postgresql_flexible_server.spine.fqdn}/spine?ssl=require"

    # Auth
    SPINE_JWT_SECRET = var.jwt_secret
    SPINE_SETUP_KEY  = var.setup_key

    # Cookies — SameSite=None required for cross-site Vercel ↔ Azure cookies
    SPINE_COOKIE_SECURE   = "true"
    SPINE_COOKIE_SAMESITE = "none"

    # CORS — allow the Vercel frontend
    SPINE_CORS_ORIGINS = var.frontend_url

    # Persistent file storage under /home (Azure Files mount, survives restarts)
    SPINE_UPLOADS_PATH  = "/home/spine/uploads"
    SPINE_PARSED_PATH   = "/home/spine/parsed"
    SPINE_KEY_FILE_PATH = "/home/spine/.spine.key"

    # Optional
    SPINE_TAVILY_API_KEY = var.tavily_api_key

    # Tell Oryx to install requirements.txt on every zip deploy
    SCM_DO_BUILD_DURING_DEPLOYMENT = "true"
  }
}
