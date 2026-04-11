import axios, { type AxiosInstance } from "axios";

export interface ApiClientOptions {
  baseURL: string;
  withCredentials?: boolean;
}

export const attachApiErrorMessageInterceptor = (apiClient: AxiosInstance) => {
  apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
      if (axios.isAxiosError(error)) {
        const payload = error.response?.data as
          | { message?: unknown }
          | string
          | undefined;
        const responseMessage =
          typeof payload === "string"
            ? payload.trim()
            : typeof payload?.message === "string"
              ? payload.message.trim()
              : "";

        if (responseMessage) {
          error.message = responseMessage;
        }
      }

      return Promise.reject(error);
    },
  );

  return apiClient;
};

export function createApiClient(options: ApiClientOptions) {
  return attachApiErrorMessageInterceptor(
    axios.create({
      baseURL: options.baseURL,
      withCredentials: options.withCredentials,
    }),
  );
}
