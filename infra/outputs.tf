output "backend_url" {
  description = "Azure App Service backend URL — set as NEXT_PUBLIC_API_URL in Vercel"
  value       = "https://${azurerm_linux_web_app.backend.default_hostname}"
}

output "db_host" {
  description = "PostgreSQL Flexible Server FQDN"
  value       = azurerm_postgresql_flexible_server.spine.fqdn
}

output "resource_group" {
  description = "Resource group name"
  value       = azurerm_resource_group.spine.name
}
