from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    """Page-number pagination shared by list endpoints.

    Response shape: {"count", "next", "previous", "results"}.
    ?page=N picks the page, ?page_size=N (max 50) overrides the default 12 -
    12 fills a 3- or 4-column card grid evenly.
    """

    page_size = 12
    page_size_query_param = "page_size"
    max_page_size = 50
