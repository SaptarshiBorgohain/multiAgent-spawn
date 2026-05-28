from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    deepseek_api_key: str = ""
    google_places_api_key: str = ""

    redis_url: str = "redis://localhost:6379"
    database_url: str = "postgresql+asyncpg://tripweave:tripweave_secret@localhost:5432/tripweave"
    elasticsearch_url: str = "http://localhost:9200"

    secret_key: str = "change_me"
    environment: str = "development"

    resend_api_key: str = ""
    app_url: str = "http://localhost:3000"

    class Config:
        env_file = ".env"


settings = Settings()
