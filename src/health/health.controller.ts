import { Controller, Get } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

@Controller("health")
export class HealthController {
  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  @Get()
  async check() {
    const checks = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: "unknown",
    };

    // Check database connection
    try {
      await this.dataSource.query("SELECT 1");
      checks.database = "ok";
    } catch (error) {
      checks.database = "error";
      checks.status = "degraded";
    }

    return checks;
  }

  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready() {
    // Check if all critical services are ready
    try {
      await this.dataSource.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return { status: "not ready" };
    }
  }
}
