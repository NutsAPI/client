import type { ApiRequestBase, ApiResponseBase, ApiSchemaBase, Conv, ConvChain, ConvWorker, HttpRequestMethod} from '@nutsapi/types';
import { toBase64URL } from '@nutsapi/types';
import { convToObject, convToPayload } from '@nutsapi/types';


type AllEndPoint<Schema extends ApiSchemaBase> = (keyof Schema & string);
type AllMethod<Schema extends ApiSchemaBase, T extends AllEndPoint<Schema>> = (keyof Schema[T] & HttpRequestMethod);


type ExtractSchema<
  Schema extends ApiSchemaBase,
  T extends AllEndPoint<Schema> = AllEndPoint<Schema>,
  U extends AllMethod<Schema, T> = AllMethod<Schema, T>,
> = 
  Schema[T][U] extends { request: ApiRequestBase, response: ApiResponseBase } ? Schema[T][U] : never;

type RequestType<
  Schema extends ApiSchemaBase,
  Convs extends Conv[],
  T extends AllEndPoint<Schema>,
  U extends AllMethod<Schema, T>,
> = 
  {
    request: ConvChain<ExtractSchema<Schema, T, U>['request']['_output'], Convs, 'payload', 'object'>,
    response: {
      [S in (keyof ExtractSchema<Schema, T, U>['response']) & number]:
        ConvChain<ExtractSchema<Schema, T, U>['response'][S]['_output'], Convs, 'payload', 'object'>
    },
  };

export class NutsAPIClient<Schema extends ApiSchemaBase, Convs extends Conv[] = []>  {

  constructor(
    private converters: { [P in keyof Convs]: ConvWorker<Convs[P]> },
  ){}

  private uriPrefix = '';

  public customServerAddress(address: string) {
    this.uriPrefix = address;
    return this;
  }

  public open<T extends AllEndPoint<Schema>, U extends AllMethod<Schema, T>>
  (endpoint: T, method: U, withCredentials = true): NutsAPIRequest<
    RequestType<Schema, Convs, T, U>['request'], 
    RequestType<Schema, Convs, T, U>['response'],
    Convs 
  > {
    return new NutsAPIRequest<
      RequestType<Schema, Convs, T, U>['request'], 
      RequestType<Schema, Convs, T, U>['response'],
      Convs 
    >(method, this.uriPrefix + endpoint, withCredentials, this.converters);
  }

}

type Mapped<U> = { [P in keyof U & number]: { code: P, body: U[P] } };
export type Responses<U> = Mapped<U>[keyof Mapped<U>];

type FailedResponse = { reason: 'timeout' | 'error' | 'json' };

export class NutsAPIRequest<T, U extends Record<number, unknown>, Convs extends Conv[] = []> {

  private xhr = new XMLHttpRequest();
  private data: T | null = null;

  constructor(
    private method: HttpRequestMethod,
    private uri: string,
    withCredentials: boolean,
    private converters: { [P in keyof Convs]: ConvWorker<Convs[P]> },
  ) {
    this.xhr.timeout = 10000;
    this.xhr.withCredentials = withCredentials;
  }

  public timeout(timeout: number) {
    this.xhr.timeout = timeout;
    return this;
  }

  public send(data: T) {
    this.data = data;
    return this;
  }

  public async fetch() {
    return new Promise<Responses<U>>((resolve, reject: (reason: FailedResponse) => void) => {
      const rejectWith = (reason: FailedResponse['reason']) => reject({ reason });
      (xhr => {
        const convertedPayload = JSON.stringify(this.data === null ? null : convToPayload(this.data, this.converters));

        xhr.open(this.method, `${this.uri}${this.method === 'GET' && convertedPayload !== null ? `?payload=${encodeBase64URL(convertedPayload)}` : ''}`);

        xhr.addEventListener('load', () => {
          try {
            const jsonPayload = JSON.parse(xhr.responseText) as unknown;
            const response: Responses<U> = {
              code: xhr.status,
              body: convToObject(jsonPayload, this.converters),
            };
            resolve(response);
          } catch {
            rejectWith('json');
          }
        });
        xhr.addEventListener('timeout', () => rejectWith('timeout'));
        xhr.addEventListener('error', () => rejectWith('error'));
        
        xhr.setRequestHeader('Content-Type', 'application/json; charset=UTF-8' );
        
        if (this.method === 'GET') { xhr.send(); } else { xhr.send(convertedPayload); }
      })(this.xhr);
    });
  }
}

function encodeBase64URL(str: string) {
  return toBase64URL(window.btoa(encodeURIComponent(str)));
}
