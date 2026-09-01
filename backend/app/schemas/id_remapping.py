from pydantic import BaseModel
from typing import List, Optional


class DatabaseConnectionInfo(BaseModel):
    host: str
    port: int
    database: str
    username: str
    password: str
    schema_name: Optional[str] = "public"


class IdMappingItem(BaseModel):
    old_id: str
    new_id: str
    is_swap: Optional[bool] = False
    is_displace: Optional[bool] = False
    displaced_new_id: Optional[str] = None
    parent_rows_old: Optional[int] = 0
    parent_rows_new: Optional[int] = 0


class RelatedTableInfo(BaseModel):
    child_schema: str = "public"
    child_table: str
    foreign_key_column: str
    parent_schema: str = "public"
    parent_table: str = ""
    parent_primary_key: str
    constraint_name: str
    match_type: str = "foreign_key"  # "foreign_key" or "logical_column"
    records_count_old: int = 0
    records_count_new: int = 0
    affected_rows_count: int = 0
    selected: bool = True


class SelectedChildTable(BaseModel):
    child_schema: str = "public"
    child_table: str
    foreign_key_column: str


class DiscoveredRelatedTable(BaseModel):
    child_schema: str = "public"
    child_table: str
    foreign_key_column: str
    parent_schema: str = "public"
    parent_table: str = ""
    parent_primary_key: str = "id"
    constraint_name: str = ""
    match_type: str = "foreign_key"  # "foreign_key" or "logical_column"
    data_type: str = "integer"


class TableDiscoveryRequest(BaseModel):
    connection: DatabaseConnectionInfo
    parent_schema: Optional[str] = "public"
    parent_table: str
    target_schema: Optional[str] = None  # None or specific schema or "__ALL__"


class TableDiscoveryResponse(BaseModel):
    success: bool
    parent_schema: str = "public"
    parent_table: str
    primary_key_column: str = "id"
    related_tables: List[DiscoveredRelatedTable] = []
    error: Optional[str] = None


class IdRemapPreviewRequest(BaseModel):
    connection: DatabaseConnectionInfo
    parent_schema: Optional[str] = None
    parent_table: str
    old_id: Optional[str] = None
    new_id: Optional[str] = None
    mappings: Optional[List[IdMappingItem]] = None
    target_schemas: Optional[List[str]] = None
    selected_child_tables: Optional[List[SelectedChildTable]] = None
    conflict_mode: Optional[str] = "swap"  # "swap" or "auto_displace" or "child_only"


class IdRemapPreviewResponse(BaseModel):
    success: bool
    parent_schema: str = "public"
    parent_table: str
    primary_key_column: str
    old_id: Optional[str] = ""
    new_id: Optional[str] = ""
    is_swap: bool = False
    operation_type: str = "remap"  # "remap" or "swap" or "multi_swap" / "multi_remap" / "auto_displace" / "child_only"
    conflict_mode: Optional[str] = "swap"
    parent_rows_old: int = 0
    parent_rows_new: int = 0
    parent_row_exists: bool = True
    new_id_exists: bool = False
    conflict_message: Optional[str] = None
    related_tables: List[RelatedTableInfo] = []
    total_affected_records: int = 0
    mappings: List[IdMappingItem] = []
    total_mappings_count: int = 1
    total_swaps_count: int = 0
    total_remaps_count: int = 0
    total_displaces_count: int = 0


class IdRemapExecuteRequest(BaseModel):
    connection: DatabaseConnectionInfo
    parent_schema: Optional[str] = None
    parent_table: str
    primary_key_column: Optional[str] = None
    old_id: Optional[str] = None
    new_id: Optional[str] = None
    mappings: Optional[List[IdMappingItem]] = None
    selected_child_tables: List[SelectedChildTable]
    conflict_mode: Optional[str] = "swap"  # "swap" or "auto_displace" or "child_only"


class UpdatedChildResult(BaseModel):
    child_schema: str = "public"
    child_table: str
    foreign_key_column: str
    updated_rows: int


class IdRemapExecuteResponse(BaseModel):
    success: bool
    is_swap: bool = False
    operation_type: str = "remap"
    conflict_mode: Optional[str] = "swap"
    message: str
    parent_schema: str = "public"
    parent_table: str
    old_id: Optional[str] = ""
    new_id: Optional[str] = ""
    mappings: List[IdMappingItem] = []
    updated_parent_rows: int
    displaced_rows_count: int = 0
    updated_child_tables: List[UpdatedChildResult] = []
    timestamp: str
    operation_id: Optional[str] = None


class IdRemapRevertRequest(BaseModel):
    connection: DatabaseConnectionInfo
    operation_id: Optional[str] = None


class IdRemapHistoryItem(BaseModel):
    operation_id: str
    timestamp: str
    parent_schema: str
    parent_table: str
    primary_key_column: str
    operation_type: str
    conflict_mode: str
    mappings: List[IdMappingItem]
    selected_child_tables: List[SelectedChildTable]
    message: str
    is_reverted: bool = False


class IdRemapHistoryResponse(BaseModel):
    success: bool
    history: List[IdRemapHistoryItem] = []
    last_revertible_operation: Optional[IdRemapHistoryItem] = None
