"""Store explicitly authored Markdown formats for assignment text."""
from alembic import op
import sqlalchemy as sa


revision = "core220_rich_text_formats"
down_revision = "f5a8b3d0c2e4"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("assignment", "description_format"),
    ("assignment", "solution_format"),
    ("assignmenttask", "description_format"),
)


def upgrade() -> None:
    for table, name in _COLUMNS:
        op.add_column(table, sa.Column(name, sa.String(), server_default="plain", nullable=False))


def downgrade() -> None:
    for table, name in reversed(_COLUMNS):
        op.drop_column(table, name)
