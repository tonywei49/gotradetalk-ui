import { hubApiBaseUrl } from "../config";

type DirectoryCustomer = {
    customer_user_id: string;
    display_name: string | null;
    matrix_user_id: string | null;
    handle: string | null;
};

type DirectoryEmployee = {
    company_id: string;
    company_name: string | null;
    person_id: string;
    display_name: string | null;
    title: string | null;
    username: string | null;
    display_lang: string | null;
    remark: string | null;
    is_active: boolean | null;
    matrix_user_id: string | null;
    handle: string | null;
};

type DirectoryResponse<T> = {
    items: T[];
};

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, "");
}

function withQuery(url: string, params: Record<string, string>): string {
    const search = new URLSearchParams(params).toString();
    if (!search) return url;
    return `${url}?${search}`;
}

async function getJson<T>(url: string, accessToken?: string): Promise<T> {
    const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed (${response.status})`);
    }

    return (await response.json()) as T;
}

export async function searchDirectoryCustomers(
    query: string,
    accessToken: string,
): Promise<DirectoryCustomer[]> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const url = withQuery(`${hubBaseUrl}/directory/customers/search`, { q: query });
    const response = await getJson<DirectoryResponse<DirectoryCustomer>>(url, accessToken);
    return response.items;
}

export async function searchDirectoryEmployees(
    query: string,
    accessToken: string,
): Promise<DirectoryEmployee[]> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const url = withQuery(`${hubBaseUrl}/directory/employees/search`, { q: query });
    const response = await getJson<DirectoryResponse<DirectoryEmployee>>(url, accessToken);
    return response.items;
}
