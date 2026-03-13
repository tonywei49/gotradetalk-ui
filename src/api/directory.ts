import { hubApiBaseUrl } from "../config";
import { readHubError } from "./session";

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

async function getJson<T>(url: string, accessToken?: string, hsUrl?: string | null): Promise<T> {
    const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...(hsUrl ? { "x-hs-url": hsUrl } : {}),
        },
    });

    if (!response.ok) {
        throw await readHubError(response);
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

export async function searchStaffDirectoryCustomers(
    query: string,
    hsUrl: string,
    accessToken: string,
): Promise<DirectoryCustomer[]> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const url = withQuery(`${hubBaseUrl}/staff/directory/customers/search`, { q: query, hs_url: hsUrl });
    const response = await getJson<DirectoryResponse<DirectoryCustomer>>(url, accessToken, hsUrl);
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

export async function searchStaffDirectoryEmployees(
    companyDomain: string,
    personId: string,
    hsUrl: string,
    accessToken: string,
): Promise<DirectoryEmployee[]> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const url = withQuery(`${hubBaseUrl}/staff/directory/employees/search`, {
        company_domain: companyDomain,
        person_id: personId,
        hs_url: hsUrl,
    });
    const response = await getJson<DirectoryResponse<DirectoryEmployee>>(url, accessToken, hsUrl);
    return response.items;
}

export async function searchDirectoryAll(
    query: string,
    accessToken: string,
    hsUrl?: string | null,
): Promise<
    Array<{
        profile_id: string;
        display_name: string | null;
        user_local_id: string | null;
        company_name: string | null;
        country: string | null;
        handle: string | null;
        matrix_user_id: string | null;
        user_type: string | null;
    }>
> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const url = withQuery(`${hubBaseUrl}/directory/all/search`, {
        q: query,
        ...(hsUrl ? { hs_url: hsUrl } : {}),
    });
    const response = await getJson<
        DirectoryResponse<{
            profile_id: string;
            display_name: string | null;
            user_local_id: string | null;
            company_name: string | null;
            country: string | null;
            handle: string | null;
            matrix_user_id: string | null;
            user_type: string | null;
        }>
    >(url, accessToken, hsUrl);
    return response.items;
}
