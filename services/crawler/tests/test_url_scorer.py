from domain_discovery.url_scorer import UrlScorer


def test_high_priority_contact_pages():
    scorer = UrlScorer()
    assert scorer.score("https://example.vn/lien-he").score == 100
    assert scorer.score("https://example.vn/contact").score == 100
    assert scorer.score("https://example.vn/hotline").score == 95


def test_medium_priority_branch_pages():
    scorer = UrlScorer()
    result = scorer.score("https://example.vn/chi-nhanh/ha-noi")
    assert result.score == 80
    assert "chi-nhanh" in result.matched_keywords


def test_low_priority_generic_pages():
    scorer = UrlScorer()
    assert scorer.score("https://example.vn/gioi-thieu").score == 40


def test_default_score_for_unmatched_url():
    scorer = UrlScorer()
    result = scorer.score("https://example.vn/san-pham/product-123")
    assert result.score == 10
    assert result.matched_keywords == []


def test_deny_pattern_overrides_everything():
    scorer = UrlScorer()
    # "login" appears in a deny pattern -- must score 0 even though nothing else matches.
    result = scorer.score("https://example.vn/wp-admin/login")
    assert result.score == 0


def test_case_insensitive_matching():
    scorer = UrlScorer()
    assert scorer.score("https://example.vn/LIEN-HE").score == 100


def test_contact_scores_higher_than_blog():
    scorer = UrlScorer()
    contact = scorer.score("https://example.vn/contact")
    blog = scorer.score("https://example.vn/blog/2023/something")
    assert contact.score > blog.score
