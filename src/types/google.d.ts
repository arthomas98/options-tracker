// TypeScript declarations for Google Identity Services and Sheets API

// Google Identity Services (GIS) Token Model
declare namespace google {
  namespace accounts {
    namespace oauth2 {
      interface TokenClient {
        requestAccessToken(overrideConfig?: { prompt?: string }): void;
        callback: (response: TokenResponse) => void;
      }

      interface TokenClientConfig {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: TokenError) => void;
        prompt?: '' | 'none' | 'consent' | 'select_account';
        hint?: string;
      }

      interface TokenResponse {
        access_token: string;
        expires_in: number;
        scope: string;
        token_type: string;
        error?: string;
        error_description?: string;
        error_uri?: string;
      }

      interface TokenError {
        type: string;
        message?: string;
      }

      function initTokenClient(config: TokenClientConfig): TokenClient;
      function revoke(token: string, callback?: () => void): void;
      function hasGrantedAllScopes(tokenResponse: TokenResponse, ...scopes: string[]): boolean;
    }
  }
}

// Google API Client (gapi)
declare namespace gapi {
  function load(api: string, callback: () => void): void;

  namespace client {
    function init(config: { apiKey?: string; discoveryDocs?: string[] }): Promise<void>;
    function setToken(token: { access_token: string } | null): void;
    function getToken(): { access_token: string } | null;

    namespace sheets {
      namespace spreadsheets {
        function create(request: {
          resource: SpreadsheetResource;
        }): Promise<{ result: Spreadsheet }>;

        function get(request: {
          spreadsheetId: string;
          includeGridData?: boolean;
        }): Promise<{ result: Spreadsheet }>;

        namespace values {
          function get(request: {
            spreadsheetId: string;
            range: string;
            valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
            dateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
          }): Promise<{ result: ValueRange }>;

          function update(request: {
            spreadsheetId: string;
            range: string;
            valueInputOption: 'RAW' | 'USER_ENTERED';
            resource: { values: unknown[][] };
          }): Promise<{ result: UpdateValuesResponse }>;

          function batchGet(request: {
            spreadsheetId: string;
            ranges: string[];
            valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
          }): Promise<{ result: BatchGetValuesResponse }>;

          function batchUpdate(request: {
            spreadsheetId: string;
            resource: {
              valueInputOption: 'RAW' | 'USER_ENTERED';
              data: { range: string; values: unknown[][] }[];
            };
          }): Promise<{ result: BatchUpdateValuesResponse }>;

          function clear(request: {
            spreadsheetId: string;
            range: string;
          }): Promise<{ result: ClearValuesResponse }>;
        }

        function batchUpdate(request: {
          spreadsheetId: string;
          resource: {
            requests: SheetRequest[];
          };
        }): Promise<{ result: BatchUpdateSpreadsheetResponse }>;
      }
    }

    namespace drive {
      namespace files {
        function list(request: {
          q?: string;
          spaces?: string;
          fields?: string;
          pageSize?: number;
        }): Promise<{ result: FileList }>;
      }
    }
  }
}

// Spreadsheet types
interface SpreadsheetResource {
  properties?: {
    title?: string;
  };
  sheets?: SheetResource[];
}

interface SheetResource {
  properties?: {
    sheetId?: number;
    title?: string;
    index?: number;
  };
  data?: GridData[];
}

interface GridData {
  startRow?: number;
  startColumn?: number;
  rowData?: RowData[];
}

interface RowData {
  values?: CellData[];
}

interface CellData {
  userEnteredValue?: ExtendedValue;
  effectiveValue?: ExtendedValue;
  formattedValue?: string;
}

interface ExtendedValue {
  numberValue?: number;
  stringValue?: string;
  boolValue?: boolean;
  formulaValue?: string;
}

interface Spreadsheet {
  spreadsheetId: string;
  properties: {
    title: string;
  };
  sheets: Sheet[];
  spreadsheetUrl: string;
}

interface Sheet {
  properties: {
    sheetId: number;
    title: string;
    index: number;
  };
}

interface ValueRange {
  range: string;
  majorDimension?: 'ROWS' | 'COLUMNS';
  values?: unknown[][];
}

interface UpdateValuesResponse {
  spreadsheetId: string;
  updatedRange: string;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
}

interface BatchGetValuesResponse {
  spreadsheetId: string;
  valueRanges: ValueRange[];
}

interface BatchUpdateValuesResponse {
  spreadsheetId: string;
  totalUpdatedRows: number;
  totalUpdatedColumns: number;
  totalUpdatedCells: number;
  totalUpdatedSheets: number;
  responses: UpdateValuesResponse[];
}

interface ClearValuesResponse {
  spreadsheetId: string;
  clearedRange: string;
}

interface BatchUpdateSpreadsheetResponse {
  spreadsheetId: string;
  replies: object[];
}

interface SheetRequest {
  addSheet?: {
    properties: {
      title: string;
      index?: number;
    };
  };
  deleteSheet?: {
    sheetId: number;
  };
  updateSheetProperties?: {
    properties: {
      sheetId: number;
      title?: string;
    };
    fields: string;
  };
}

interface FileList {
  files: DriveFile[];
  nextPageToken?: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

// Extend Window interface
interface Window {
  google?: typeof google;
  gapi?: typeof gapi;
}
